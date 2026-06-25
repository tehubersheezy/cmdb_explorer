// ServiceNow AMB (Asynchronous Message Bus) client — a minimal Bayeux/CometD
// implementation over a raw WebSocket to the instance's /amb endpoint.
//
// Ported from the vanilla-JS reference at mlx-audio/servicenow-amb/snow-amb.js
// and trimmed to what the CMDB Explorer needs: connect, subscribe(channel, cb),
// disconnect — same-origin (the WS URL is derived from window.location, and the
// browser session cookie carries auth on the upgrade). No window.g_messenger is
// assumed; we drive the handshake ourselves.

interface BayeuxMessage {
    id?: string
    channel: string
    clientId?: string
    subscription?: string
    successful?: boolean
    error?: string
    data?: any
    advice?: { reconnect?: 'retry' | 'handshake' | 'none'; timeout?: number; interval?: number }
    [k: string]: unknown
}

type DataCallback = (data: any, raw: BayeuxMessage) => void

interface Pending {
    resolve: (msg: BayeuxMessage) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
}

export class SnowAmb {
    private ws: WebSocket | null = null
    private clientId: string | null = null
    private msgId = 0
    private pending = new Map<string, Pending>()
    private subscriptions = new Map<string, Set<DataCallback>>()
    private connected = false
    private destroyed = false
    private keepaliveTimer: ReturnType<typeof setTimeout> | null = null
    private keepaliveTimeout = 60000

    private readonly wsUrl: string
    private readonly connectTimeout: number

    onerror: ((err: unknown) => void) | null = null

    constructor(opts: { connectTimeout?: number } = {}) {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        this.wsUrl = `${proto}://${window.location.host}/amb`
        this.connectTimeout = opts.connectTimeout ?? 10000
    }

    // ---- record-watcher channel helpers --------------------------------

    /** ServiceNow URL-safe base64: standard, then ==→-- and =→-. */
    static base64url(str: string): string {
        const b64 = btoa(unescape(encodeURIComponent(str)))
        return b64.replace(/==$/, '--').replace(/=$/, '-')
    }

    /** Record-watcher channel: /rw/<type>/<table>/<base64url(filter)>. */
    static recordChannel(table: string, filter: string, type = 'default'): string {
        return `/rw/${type}/${table}/${SnowAmb.base64url(filter)}`
    }

    // ---- lifecycle ------------------------------------------------------

    async connect(): Promise<string> {
        if (this.destroyed) throw new Error('AMB client destroyed')
        await this.openSocket()
        await this.handshake()
        await this.startKeepalive()
        this.connected = true
        return this.clientId as string
    }

    async subscribe(channel: string, cb: DataCallback): Promise<void> {
        if (!this.connected) throw new Error('AMB not connected')
        if (!this.subscriptions.has(channel)) this.subscriptions.set(channel, new Set())
        this.subscriptions.get(channel)!.add(cb)
        const resp = await this.send({ channel: '/meta/subscribe', subscription: channel, clientId: this.clientId! })
        if (!resp.successful) throw new Error(`Subscribe failed for ${channel}: ${resp.error || 'unknown'}`)
    }

    async disconnect(): Promise<void> {
        this.destroyed = true
        this.connected = false
        if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer)
        if (this.ws && this.clientId) {
            try {
                await this.send({ channel: '/meta/disconnect', clientId: this.clientId })
            } catch {
                /* ignore */
            }
        }
        this.closeSocket()
    }

    // ---- websocket ------------------------------------------------------

    private openSocket(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.closeSocket()
                reject(new Error(`AMB connect timeout (${this.connectTimeout}ms)`))
            }, this.connectTimeout)

            const ws = new WebSocket(this.wsUrl)
            this.ws = ws
            ws.onopen = () => {
                clearTimeout(timer)
                resolve()
            }
            ws.onerror = (e) => {
                clearTimeout(timer)
                this.onerror?.(e)
                reject(new Error('AMB WebSocket connection failed'))
            }
            ws.onclose = () => this.handleClose()
            ws.onmessage = (e) => this.handleMessage(e)
        })
    }

    private closeSocket(): void {
        if (this.ws) {
            this.ws.onopen = this.ws.onclose = this.ws.onerror = this.ws.onmessage = null
            if (this.ws.readyState <= WebSocket.OPEN) this.ws.close()
            this.ws = null
        }
    }

    // ---- bayeux ---------------------------------------------------------

    private async handshake(): Promise<void> {
        const resp = await this.send({
            version: '1.0',
            minimumVersion: '1.0',
            channel: '/meta/handshake',
            supportedConnectionTypes: ['websocket', 'long-polling'],
            advice: { timeout: 60000, interval: 0 },
            ext: { supportsSubscribeCommandFlow: true },
        })
        if (!resp.successful) throw new Error(`AMB handshake failed: ${resp.error || 'unknown'}`)
        this.clientId = resp.clientId as string
        if (resp.advice?.timeout) this.keepaliveTimeout = resp.advice.timeout
    }

    private async startKeepalive(): Promise<void> {
        const resp = await this.send({
            channel: '/meta/connect',
            connectionType: 'websocket',
            advice: { timeout: 0 },
            clientId: this.clientId!,
        })
        if (!resp.successful) throw new Error(`AMB connect failed: ${resp.error || 'unknown'}`)
        this.scheduleKeepalive()
    }

    private scheduleKeepalive(): void {
        if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer)
        if (this.destroyed || !this.connected) return
        const delay = Math.max(this.keepaliveTimeout - 5000, 5000)
        this.keepaliveTimer = setTimeout(async () => {
            if (!this.connected || this.destroyed) return
            try {
                await this.send({ channel: '/meta/connect', connectionType: 'websocket', clientId: this.clientId! })
                this.scheduleKeepalive()
            } catch (err) {
                this.onerror?.(err)
            }
        }, delay)
    }

    // ---- send / receive -------------------------------------------------

    private nextId(): string {
        return String(++this.msgId)
    }

    private send(msg: Partial<BayeuxMessage> & { channel: string }): Promise<BayeuxMessage> {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('AMB socket not open'))
                return
            }
            const id = this.nextId()
            ;(msg as BayeuxMessage).id = id
            const timer = setTimeout(() => {
                this.pending.delete(id)
                reject(new Error(`AMB timeout waiting for ${msg.channel} (id ${id})`))
            }, 15000)
            this.pending.set(id, { resolve, reject, timer })
            this.ws.send(JSON.stringify([msg]))
        })
    }

    private handleMessage(event: MessageEvent): void {
        let messages: BayeuxMessage[]
        try {
            const parsed = JSON.parse(String(event.data))
            messages = Array.isArray(parsed) ? parsed : [parsed]
        } catch {
            return
        }
        for (const msg of messages) {
            // Meta responses resolve their matching send() promise.
            if (msg.id && this.pending.has(msg.id)) {
                const p = this.pending.get(msg.id)!
                clearTimeout(p.timer)
                this.pending.delete(msg.id)
                p.resolve(msg)
                continue
            }
            // Data frames dispatch to channel subscribers.
            if (msg.channel && !msg.channel.startsWith('/meta/')) {
                const subs = this.subscriptions.get(msg.channel)
                if (subs) for (const cb of subs) {
                    try {
                        cb(msg.data, msg)
                    } catch (err) {
                        console.error('[SnowAmb] subscriber error', err)
                    }
                }
            }
        }
    }

    private handleClose(): void {
        this.connected = false
        if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer)
        for (const [, p] of this.pending) {
            clearTimeout(p.timer)
            p.reject(new Error('AMB socket closed'))
        }
        this.pending.clear()
    }
}
