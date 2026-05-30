const defaultBlockedNetworks = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::/128',
  '::1/128',
  '::ffff:0:0/96',
  '64:ff9b::/96',
  '100::/64',
  '2001::/23',
  '2001:db8::/32',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
]

const blockedNetworks = (
  process.env.OVERLEAF_LINKED_URL_BLOCKED_NETWORKS ||
  defaultBlockedNetworks.join(',')
)
  .split(/[,\s]+/)
  .filter(Boolean)
  .map(cidr => cidr.trim())

const allowedResources = process.env.OVERLEAF_LINKED_URL_ALLOWED_RESOURCES
  ? new RegExp(process.env.OVERLEAF_LINKED_URL_ALLOWED_RESOURCES)
  : null

module.exports = {
  externalUrlImportEnabled: process.env.EXTERNAL_URL_IMPORT_ENABLED === 'true',
  maxRedirects: 5,
  fetchTimeoutMs: 30000,
  blockedNetworks,
  allowedResources,
  userAgentHeader: {
     'User-Agent': 'Overleaf Extended CE - LinkedURLProxy (https://github.com/yu-i-i/overleaf-cep)'
  },
  maxUploadSize: process.env.MAX_UPLOAD_SIZE
    ? parseInt(process.env.MAX_UPLOAD_SIZE, 10) * 1024 * 1024
    : 50 * 1024 * 1024, // 50 MB
  internal: {
    linkedUrlProxy: {
      port: 3066,
      host: process.env.LINKED_URL_PROXY_HOST || '127.0.0.1',
    },
  },
}
