const express = require('express')
const cache = require('apicache').middleware
const getHackableJSON = require('./src/get-hackable-json')
const bodyParser = require('body-parser')
const WebSocket = require('ws');
const app = express()
const url = require('url')

const cors = require('cors')

 // pretty hacky solution to get rawbody, too tired
// to figure better solution out
// From: https://coderwall.com/p/qrjfcw/capture-raw-post-body-in-express-js
let rawBodySaver = function (req, res, buf, encoding) {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
}
app.use(bodyParser.json({ verify: rawBodySaver }))
app.use(bodyParser.urlencoded({ extended: false, verify: rawBodySaver }))
app.use(bodyParser.raw({ verify: rawBodySaver, type: function () { return true } }))

app.use(cors())

const isWebhookRequestValid = require('./src/is-webhook-request-valid')

let isWarmupTriggered = false
let hackableJSONCache = {}
function ensureWarmup() {
  if (isWarmupTriggered) return
  isWarmupTriggered = true
  getHackableJSON()
    .then(response => response.reduce((lookup, user) => ({
      ...lookup,
      ...{ [user.username] : user.hackablejson }
    }), {}))
    .then(cache => {
      hackableJSONCache = cache
    })
}

app.get('/hackablejson', (req, res) => {
  ensureWarmup()
  res.json(hackableJSONCache)
})

app.post('/webhook', (req, res) => {
  if (!isWebhookRequestValid(req)) {
    res.status(403).send('invalid signature')
    return
  }

  if(req.headers['x-discourse-event'] === 'user_updated') {

      const HACKABLE_JSON_FIELD_ID = 1

      const snapshot = {
        username: req.body.user.username,
        hackablejson:
          req.body.user.user_fields &&
          req.body.user.user_fields[''+HACKABLE_JSON_FIELD_ID]
      }

      if (!snapshot.hackablejson) {
        // don't add this user, they might not want to be public
        res.status(200).send('carry on')
        return
      }

      hackableJSONCache[snapshot.username] = snapshot.hackablejson
      res.status(200).send('cache updated')
      sendToAll(JSON.stringify(snapshot))
      return

  } else {
    res.status(200).send('event ignored')
  }

})

const server = require('http').createServer(app)
const wss = new WebSocket.Server({ server })

const sockets = []
wss.on('connection', function connection(ws, req) {

  const location = url.parse(req.url, true);
  console.log('location',location)
  if (location.path === '/hackablejson') {
    console.log('ws connected', req.url)
    sockets.push(ws)
  }
  ws.on('error', () => {})

})

function sendToAll(msg) {
  sockets.slice().forEach(socket => {
    try {
      socket.send(JSON.stringify(msg))
    } catch (err) {
      sockets.splice(sockets.indexOf(socket), 1)
      socket.terminate()
    }
  })
}

const port = process.env.PORT || 3001
server.listen(port, () => {
  console.log('listening on port', port)
})
