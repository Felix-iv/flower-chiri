import { createHmac, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import { spawn } from 'node:child_process'
import process from 'node:process'

const host = process.env.BLOG_WEBHOOK_HOST ?? '127.0.0.1'
const port = Number(process.env.BLOG_WEBHOOK_PORT ?? 3210)
const path = process.env.BLOG_WEBHOOK_PATH ?? '/github/obsidian-webhook'
const secret = process.env.BLOG_WEBHOOK_SECRET
const deployScript = process.env.BLOG_DEPLOY_SCRIPT ?? '/home/yim/flower-chiri/scripts/deploy-blog'
const deployBranch = process.env.BLOG_WEBHOOK_BRANCH ?? 'refs/heads/main'
const maxBodyBytes = Number(process.env.BLOG_WEBHOOK_MAX_BODY_BYTES ?? 1024 * 1024)

let isDeploying = false

type ProcessWithExitEvent = {
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): void
}

function json(res: http.ServerResponse, statusCode: number, body: Record<string, unknown>) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function verifySignature(body: Buffer, signatureHeader: string | undefined) {
  if (!secret) return false
  if (!signatureHeader?.startsWith('sha256=')) return false

  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(signatureHeader)

  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBodyBytes) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function runDeploy() {
  if (isDeploying) {
    console.log('已有部署任务正在运行，忽略本次触发。')
    return
  }

  isDeploying = true
  const child = spawn(deployScript, [], {
    stdio: 'inherit',
    env: process.env
  }) as unknown as ProcessWithExitEvent

  child.on('exit', (code, signal) => {
    isDeploying = false
    if (code === 0) {
      console.log('部署脚本执行完成。')
      return
    }
    console.error(`部署脚本异常结束：code=${code ?? 'null'} signal=${signal ?? 'null'}`)
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    json(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && req.url === path) {
    json(res, 200, { ok: true, service: 'obsidian-webhook' })
    return
  }

  if (req.method !== 'POST' || req.url !== path) {
    json(res, 404, { ok: false, error: 'not found' })
    return
  }

  let body: Buffer
  try {
    body = await readBody(req)
  } catch (error) {
    json(res, 413, { ok: false, error: error instanceof Error ? error.message : 'failed to read body' })
    return
  }

  if (!verifySignature(body, req.headers['x-hub-signature-256'] as string | undefined)) {
    json(res, 401, { ok: false, error: 'invalid signature' })
    return
  }

  const event = req.headers['x-github-event']
  if (event === 'ping') {
    console.log('收到 GitHub ping 事件。')
    json(res, 200, { ok: true, event: 'ping' })
    return
  }

  if (event !== 'push') {
    json(res, 202, { ok: true, skipped: `ignored event ${String(event)}` })
    return
  }

  let payload: { ref?: string }
  try {
    payload = JSON.parse(body.toString('utf8')) as { ref?: string }
  } catch {
    json(res, 400, { ok: false, error: 'invalid json payload' })
    return
  }

  if (payload.ref !== deployBranch) {
    json(res, 202, { ok: true, skipped: `ignored ref ${payload.ref ?? 'unknown'}` })
    return
  }

  runDeploy()
  console.log(`收到 ${deployBranch} push 事件，已触发部署。`)
  json(res, 202, { ok: true, deployment: 'started' })
})

if (!secret) {
  console.error('缺少 BLOG_WEBHOOK_SECRET，拒绝启动 webhook 服务。')
  process.exit(1)
}

server.listen(port, host, () => {
  console.log(`Obsidian webhook listening on http://${host}:${port}${path}`)
})
