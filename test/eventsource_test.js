/* eslint-disable no-new */
var EventSource = require('../lib/eventsource').EventSource
var bufferFrom = require('buffer-from')
var mocha = require('mocha')
var assert = require('assert')
var tunnel = require('tunnel')
const { AsyncQueue, TestHttpHandlers, TestHttpServers, sleepAsync, withCloseable } =
  require('launchdarkly-js-test-helpers')

var it = mocha.it
var describe = mocha.describe

const deliberatelyUnusedPort = 44444

async function withServer (action) {
  await withCloseable(TestHttpServers.start, action)
}

async function withEventSource (server, opts, action) {
  const es = new EventSource(server.url, action === undefined ? undefined : opts)

  // Set a default error handler to avoid uncaught rejections, since in most of our
  // tests the EventSource is likely to get an error we don't care about when the
  // test is being torn down
  es.onerror = () => {}

  await withCloseable(es, action || opts)
}

async function waitForOpenEvent (es) {
  const opened = new AsyncQueue()
  es.onopen = e => opened.add(e)
  return opened.take()
}

function startErrorQueue (es) {
  const errors = new AsyncQueue()
  es.onerror = e => errors.add(e)
  return errors
}

function startMessageQueue (es) {
  const messages = new AsyncQueue()
  es.onmessage = m => messages.add(m)
  return messages
}

async function shouldReceiveMessages (es, messages) {
  const queue = startMessageQueue(es)
  for (const expected of messages) {
    const actual = await queue.take()
    assert.equal(expected.data, actual.data)
    assert.equal(expected.type || 'message', actual.type)
  }
}

async function expectNothingReceived (q) {
  await sleepAsync(100)
  assert.ok(q.isEmpty())
}

function writeEvents (chunks) {
  const q = new AsyncQueue()
  chunks.forEach(chunk => q.add(chunk))
  return TestHttpHandlers.chunkedStream(200, {'Content-Type': 'text/event-stream'}, q)
}

function assertRange (min, max, value) {
  if (value < min || value > max) {
    throw new Error('' + value + ' was not in range [' + min + ', ' + max + ']')
  }
}

describe('Parser', () => {
  it('parses multibyte characters', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['id: 1\ndata: €豆腐\n\n']))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: '€豆腐' }
        ])
      })
    })
  })

  it('parses empty lines with multibyte characters', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['\n\n\n\nid: 1\ndata: 我現在都看實況不玩遊戲\n\n']))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: '我現在都看實況不玩遊戲' }
        ])
      })
    })
  })

  it('parses one one-line message in one chunk', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: Hello\n\n']))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: 'Hello' }
        ])
      })
    })
  })

  it('ignores byte-order mark', async () => {
    await withServer(async server => {
      server.byDefault((req, res) => {
        res.writeHead(200, {'Content-Type': 'text/event-stream'})
        res.write('\uFEFF')
        res.write('data: foo\n\n')
        res.end()
      })

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: 'foo' }
        ])
      })
    })
  })

  it('parses one one-line message in two chunks', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: Hel', 'lo\n\n']))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: 'Hello' }
        ])
      })
    })
  })

  it('parses two one-line messages in one chunk', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: Hello\n\n', 'data: World\n\n']))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: 'Hello' },
          { data: 'World' }
        ])
      })
    })
  })

  it('parses one two-line message in one chunk', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: Hello\ndata:World\n\n']))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: 'Hello\nWorld' }
        ])
      })
    })
  })

  it('parses chopped up unicode data', async () => {
    await withServer(async server => {
      const chopped = 'data: Aslak\n\ndata: Hellesøy\n\n'.split('')
      server.byDefault(writeEvents(chopped))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: 'Aslak' },
          { data: 'Hellesøy' }
        ])
      })
    })
  })

  it('parses really chopped up unicode data', async () => {
    await withServer(async server => {
      const content = 'Aslak Hellesøy is the original author'
      server.byDefault((req, res) => {
        const msg = bufferFrom('data: ' + content + '\n\n')
        res.writeHead(200, {'Content-Type': 'text/event-stream'})

        // Slice in the middle of a unicode sequence (ø), making sure that one data
        // chunk will contain the first byte and the second chunk will get the other
        res.write(msg.slice(0, 19), 'binary', function () {
          res.write(msg.slice(19))
        })
      })

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: content }
        ])
      })
    })
  })

  it('accepts CRLF as separator', async () => {
    await withServer(async server => {
      const chopped = 'data: Aslak\r\n\r\ndata: Hellesøy\r\n\r\n'.split('')
      server.byDefault(writeEvents(chopped))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: 'Aslak' },
          { data: 'Hellesøy' }
        ])
      })
    })
  })

  it('accepts CR as separator', async () => {
    await withServer(async server => {
      const chopped = 'data: Aslak\r\rdata: Hellesøy\r\r'.split('')
      server.byDefault(writeEvents(chopped))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: 'Aslak' },
          { data: 'Hellesøy' }
        ])
      })
    })
  })

  it('delivers message with explicit event', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['event: greeting\ndata: Hello\n\n']))

      await withEventSource(server, async es => {
        const messages = new AsyncQueue()
        es.addEventListener('greeting', m => messages.add(m))

        const m = await messages.take()
        assert.equal(m.data, 'Hello')
      })
    })
  })

  it('allows removal of event listeners', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['event: greeting\ndata: Hello\n\n', 'event: greeting\ndata: World\n\n']))

      await withEventSource(server, async es => {
        const messages1 = new AsyncQueue()
        const messages2 = new AsyncQueue()

        function add1 (m) { messages1.add(m) }
        function add2 (m) { messages2.add(m) }
        es.addEventListener('greeting', add1)
        es.addEventListener('greeting', add2)
        es.removeEventListener('greeting', add1, false)

        await messages2.take()
        await expectNothingReceived(messages1)
      })
    })
  })

  it('ignores comments', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: Hello\n\n:nothing to see here\n\ndata: World\n\n']))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: 'Hello' },
          { data: 'World' }
        ])
      })
    })
  })

  it('ignores empty comments', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: Hello\n\n:\n\ndata: World\n\n']))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: 'Hello' },
          { data: 'World' }
        ])
      })
    })
  })

  it('does not ignore multilines strings', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: line one\ndata:\ndata: line two\n\n']))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: 'line one\n\nline two' }
        ])
      })
    })
  })

  it('does not ignore multilines strings even in data beginning', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data:\ndata:line one\ndata: line two\n\n']))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: '\nline one\nline two' }
        ])
      })
    })
  })

  it('treats field name without colon as a field with an empty value', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data\n\ndata\ndata\n\n']))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: '' },
          { data: '\n' }
        ])
      })
    })
  })

  it('causes entire event to be ignored for empty event field', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['event:\n\ndata: Hello\n\n']))

      await withEventSource(server, async es => {
        const originalEmit = es.emit
        const events = new AsyncQueue()
        es.emit = function (e) {
          events.add(e)
          return originalEmit.apply(this, arguments)
        }
        await shouldReceiveMessages(es, [
          { data: 'Hello' }
        ])
        while (!events.isEmpty()) {
          const e = await events.take()
          assert.ok(e === 'open' || e === 'message' || e === 'closed')
        }
      })
    })
  })

  it('parses relatively huge messages efficiently', async function () {
    this.timeout(1000)

    await withServer(async server => {
      const longMessageContent = new Array(100000).join('a')
      const longMessage = 'data: ' + longMessageContent + '\n\n'
      server.byDefault(writeEvents([longMessage]))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: longMessageContent }
        ])
      })
    })
  })

  it('parses a relatively huge message across many chunks efficiently', async function () {
    this.timeout(1000)

    await withServer(async server => {
      const longMessageContent = new Array(100000).join('a')
      const longMessage = 'data: ' + longMessageContent + '\n\n'
      const longMessageChunks = longMessage.match(/[\s\S]{1,10}/g) // Split the message into chunks of 10 characters
      server.byDefault(writeEvents(longMessageChunks))

      await withEventSource(server, async es => {
        await shouldReceiveMessages(es, [
          { data: longMessageContent }
        ])
      })
    })
  })
})

describe('HTTP Request', () => {
  it('passes cache-control: no-cache to server', async () => {
    await withServer(async server => {
      await withEventSource(server, async es => {
        const req = await server.nextRequest()
        assert.equal('no-cache', req.headers['cache-control'])
      })
    })
  })

  function stripIrrelevantHeaders (headers) {
    var h = Object.assign({}, headers)
    delete h['connection']
    delete h['host']
    return h
  }

  it('sets request headers', async () => {
    await withServer(async server => {
      const headers = {
        'User-Agent': 'test',
        'Cookie': 'test=test',
        'Last-Event-ID': '99'
      }
      await withEventSource(server, { headers }, async es => {
        const req = await server.nextRequest()
        assert.deepStrictEqual(stripIrrelevantHeaders(req.headers), {
          accept: 'text/event-stream',
          'cache-control': 'no-cache',
          'user-agent': 'test',
          cookie: 'test=test',
          'last-event-id': '99'
        })
      })
    })
  })

  it('can omit default headers', async () => {
    await withServer(async server => {
      const headers = {
        'User-Agent': 'test',
        'Cookie': 'test=test',
        'Last-Event-ID': '99'
      }
      const opts = { headers, skipDefaultHeaders: true }
      await withEventSource(server, opts, async es => {
        const req = await server.nextRequest()
        assert.deepStrictEqual(stripIrrelevantHeaders(req.headers), {
          'user-agent': 'test',
          cookie: 'test=test',
          'last-event-id': '99'
        })
      })
    })
  })

  it("does not set request headers that don't have a value", async () => {
    await withServer(async server => {
      const headers = {
        'User-Agent': 'test',
        'Cookie': 'test=test',
        'Last-Event-ID': '99',
        'X-Something': null
      }
      await withEventSource(server, { headers }, async es => {
        const req = await server.nextRequest()
        assert.equal(req.headers['user-agent'], 'test')
        assert.equal(req.headers['cookie'], 'test=test')
        assert.equal(req.headers['last-event-id'], '99')
        assert.equal(req.headers['X-Something'], undefined)
      })
    })
  })

  it('uses GET method by default', async () => {
    await withServer(async server => {
      await withEventSource(server, async es => {
        const req = await server.nextRequest()
        assert.equal(req.method, 'get')
      })
    })
  })

  it('can specify HTTP method and body', async () => {
    const content = '{ "test": true }'

    await withServer(async server => {
      const opts = { method: 'POST', body: content }
      await withEventSource(server, opts, async es => {
        const req = await server.nextRequest()
        assert.equal(req.method, 'post')
        assert.equal(req.body, content)
      })
    })
  })

  it('sends correct Last-Event-ID http header when an initial Last-Event-ID header was specified in the constructor', async () => {
    await withServer(async server => {
      const opts = { headers: { 'Last-Event-ID': '9' } }
      await withEventSource(server, opts, async es => {
        const req = await server.nextRequest()
        assert.equal(req.headers['last-event-id'], 9)
      })
    })
  });

  [301, 307].forEach((status) => {
    it('follows http ' + status + ' redirect', async () => {
      const redirectSuffix = '/foobar'

      await withServer(async server => {
        server.forMethodAndPath('get', '/', TestHttpHandlers.respond(status,
          {'Connection': 'Close', 'Location': server.url + redirectSuffix}))
        server.forMethodAndPath('get', redirectSuffix, writeEvents(['data: hello\n\n']))

        await withEventSource(server, async es => {
          const request1 = await server.nextRequest()
          assert.equal(request1.path, '/')

          const request2 = await server.nextRequest()
          assert.equal(request2.path, redirectSuffix)
        })
      })
    })

    it('causes error event when response is ' + status + ' with missing location', async () => {
      await withServer(async server => {
        server.byDefault(TestHttpHandlers.respond(status, {'Connection': 'Close'}))

        await withEventSource(server, async es => {
          const errors = startErrorQueue(es)
          const err = await errors.take()
          assert.equal(err.status, status)
        })
      })
    })
  });

  [401, 403].forEach(function (status) {
    it('causes error event when response status is ' + status, async () => {
      await withServer(async server => {
        server.byDefault(TestHttpHandlers.respond(status))

        await withEventSource(server, async es => {
          const errors = startErrorQueue(es)
          const err = await errors.take()
          assert.equal(err.status, status)
        })
      })
    })
  })
})

describe('HTTPS Support', () => {
  it('uses https for https urls', async () => {
    await withCloseable(TestHttpServers.startSecure, async server => {
      server.byDefault(writeEvents(['data: hello\n\n']))

      const opts = { rejectUnauthorized: false }
      await withEventSource(server, opts, async es => {
        await shouldReceiveMessages(es, [
          { data: 'hello' }
        ])
      })
    })
  })
})

describe('Reconnection', () => {
  const briefDelay = 1
  const delayOpts = { initialRetryDelayMillis: briefDelay }

  async function shouldReconnectAndGetMessage (port, es) {
    return withCloseable(() => TestHttpServers.start({}, port), async server => {
      server.byDefault(writeEvents(['data: got it\n\n']))

      await shouldReceiveMessages(es, [
        { data: 'got it' }
      ])

      return server.nextRequest()
    })
  }

  async function shouldNotReconnect (port, es) {
    await withCloseable(() => TestHttpServers.start({}, port), async server => {
      server.byDefault(writeEvents(['data: got it\n\n']))

      const messages = startMessageQueue(es)
      await expectNothingReceived(messages)
    })
  }

  it('is attempted when server is down', async () => {
    await withCloseable(new EventSource('http://localhost:' + deliberatelyUnusedPort, delayOpts), async es => {
      const errors = startErrorQueue(es)
      await errors.take()

      await shouldReconnectAndGetMessage(deliberatelyUnusedPort, es)
    })
  })

  it('is attempted when server goes down after connection', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: hello\n\n']))

      await withEventSource(server, delayOpts, async es => {
        await shouldReceiveMessages(es, [
          { data: 'hello' }
        ])

        await server.closeAndWait()

        await shouldReconnectAndGetMessage(server.port, es)
      })
    })
  })

  it('is attempted when the server responds with a 500', async () => {
    await withServer(async server => {
      server.byDefault(TestHttpHandlers.respond(500))

      await withEventSource(server, delayOpts, async es => {
        const errors = startErrorQueue(es)
        await errors.take()

        await server.closeAndWait()

        await shouldReconnectAndGetMessage(server.port, es)
      })
    })
  })

  it('is stopped when server goes down and eventsource is being closed', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: hello\n\n']))

      await withEventSource(server, delayOpts, async es => {
        const errors = startErrorQueue(es)

        await shouldReceiveMessages(es, [
          { data: 'hello' }
        ])

        await server.closeAndWait()
        await errors.take()

        // We received an error because the remote connection was closed.
        // We close es, so we do not want es to reconnect.
        es.close()

        await shouldNotReconnect(server.port, es)
      })
    })
  })

  it('is not attempted when server responds with non-200 and non-500', async () => {
    await withServer(async server => {
      server.byDefault(TestHttpHandlers.respond(204))

      await withEventSource(server, delayOpts, async es => {
        const errors = startErrorQueue(es)

        await errors.take()
        await server.closeAndWait()

        await shouldNotReconnect(server.port, es)
      })
    })
  })

  it('is attempted for non-200 and non-500 error if errorFilter says so', async () => {
    await withServer(async server => {
      server.byDefault(TestHttpHandlers.respond(204))

      const opts = { ...delayOpts, errorFilter: err => err.status === 204 }

      await withEventSource(server, opts, async es => {
        const errors = startErrorQueue(es)

        await errors.take()
        await server.closeAndWait()

        await shouldReconnectAndGetMessage(server.port, es)
      })
    })
  })

  it('sends Last-Event-ID http header when it has previously been passed in an event from the server', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['id: 10\ndata: Hello\n\n']))

      await withEventSource(server, delayOpts, async es => {
        const messages = startMessageQueue(es)
        await messages.take()

        await server.closeAndWait()

        const req = await shouldReconnectAndGetMessage(server.port, es)
        assert.equal(req.headers['last-event-id'], '10')
      })
    })
  })

  it('does not send Last-Event-ID http header when it has not been previously sent by the server', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: hello\n\n']))

      await withEventSource(server, delayOpts, async es => {
        await shouldReceiveMessages(es, [
          { data: 'hello' }
        ])

        await server.closeAndWait()

        const req = await shouldReconnectAndGetMessage(server.port, es)
        assert.equal(req.headers['last-event-id'], undefined)
      })
    })
  })
})

describe('retry delay', () => {
  async function verifyDelays (options, count, delaysAssertion) {
    await withServer(async server => {
      server.byDefault(TestHttpHandlers.respond(500))

      await withEventSource(server, options, async es => {
        const delays = new AsyncQueue()
        es.onretrying = event => delays.add(event.delayMillis)

        let allDelays = []
        while (allDelays.length < count) {
          allDelays.push(await delays.take())
        }
        delaysAssertion(allDelays)
      })
    })
  }

  it('uses constant delay by default', async () => {
    const delay = 5
    await verifyDelays(
      { initialRetryDelayMillis: delay },
      3,
      function (delays) {
        assert.deepEqual(delays, [ delay, delay, delay ])
      }
    )
  })

  it('can use backoff with maximum', async () => {
    const delay = 5
    const max = 31
    await verifyDelays(
      { initialRetryDelayMillis: delay, maxBackoffMillis: max },
      4,
      function (delays) {
        assert.deepEqual(delays, [ delay, delay * 2, delay * 4, max ])
      }
    )
  })

  it('can use backoff with jitter', async () => {
    const delay = 5
    const max = 31
    await verifyDelays(
      { initialRetryDelayMillis: delay, maxBackoffMillis: max, jitterRatio: 0.5 },
      3,
      function (delays) {
        assert.equal(delays.length, 3)
        assertRange(delay / 2, delay, delays[0])
        assertRange(delay, delay * 2, delays[1])
        assertRange(delay * 2, delay * 4, delays[2])
      }
    )
  })
})

describe('readyState', function () {
  it('has CONNECTING constant', function () {
    assert.equal(0, EventSource.CONNECTING)
  })

  it('has OPEN constant', function () {
    assert.equal(1, EventSource.OPEN)
  })

  it('has CLOSED constant', function () {
    assert.equal(2, EventSource.CLOSED)
  })

  it('has readystate constants on instances', function () {
    var es = new EventSource('http://localhost:' + deliberatelyUnusedPort)
    es.onerror = function () {}
    assert.equal(EventSource.CONNECTING, es.CONNECTING, 'constant CONNECTING missing/invalid')
    assert.equal(EventSource.OPEN, es.OPEN, 'constant OPEN missing/invalid')
    assert.equal(EventSource.CLOSED, es.CLOSED, 'constant CLOSED missing/invalid')

    es.close()
  })

  it('is CONNECTING before connection has been established', function () {
    var es = new EventSource('http://localhost:' + deliberatelyUnusedPort)
    es.onerror = function () {}
    assert.equal(EventSource.CONNECTING, es.readyState)
    es.close()
  })

  it('is CONNECTING when server has closed the connection', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents([]))

      await withEventSource(server, { initialRetryDelayMillis: 10 }, async es => {
        const errors = startErrorQueue(es)

        await waitForOpenEvent(es)

        server.close()

        await errors.take()

        assert.equal(es.readyState, EventSource.CONNECTING)
      })
    })
  })

  it('is OPEN when connection has been established', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents([]))

      await withEventSource(server, async es => {
        await waitForOpenEvent(es)

        assert.equal(es.readyState, EventSource.OPEN)
      })
    })
  })

  it('is CLOSED after connection has been closed', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents([]))

      await withEventSource(server, async es => {
        await waitForOpenEvent(es)

        es.close()

        assert.equal(es.readyState, EventSource.CLOSED)
      })
    })
  })
})

describe('Methods', function () {
  it('close method exists and can be called to close an eventsource', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents([]))

      await withEventSource(server, async es => {
        await waitForOpenEvent(es)

        assert.equal(es.close(), undefined)
      })
    })
  })

  it('close method is a prototype method', function () {
    assert.equal(typeof EventSource.prototype.close, 'function')
  })
})

describe('Properties', function () {
  it('url exposes original request url', function () {
    var url = 'http://localhost:' + deliberatelyUnusedPort
    var es = new EventSource(url)
    es.onerror = function () {}
    es.close()
    assert.equal(url, es.url)
  })
})

describe('Events', function () {
  it('calls onopen when connection is established', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents([]))

      await withEventSource(server, async es => {
        const opened = new AsyncQueue()
        es.onopen = e => opened.add(e)

        const e = await opened.take()
        assert.equal(e.type, 'open')
      })
    })
  })

  it('supplies the correct origin', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: hello\n\n']))

      await withEventSource(server, async es => {
        const messages = startMessageQueue(es)
        const m = await messages.take()
        assert.equal(m.origin, server.url)
      })
    })
  })

  it('emits open event when connection is established', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents([]))

      await withEventSource(server, async es => {
        const e = await waitForOpenEvent(es)
        assert.equal(e.type, 'open')
      })
    })
  })

  it('does not double reconnect when connection is closed by server', async () => {
    await withServer(async server => {
      let numConnections = 0
      server.byDefault((req, res) => {
        numConnections++
        // destroy only the first connection - expected only 1 other reconnect
        if (numConnections === 1) {
          res.end()
        } else {
          writeEvents([])(req, res)
        }
      })

      await withEventSource(server, async es => {
        es.reconnectInterval = 50

        await server.nextRequest()
        await server.nextRequest()

        await sleepAsync(300)
        assert.ok(server.requests.isEmpty(), 'received too many connections')
      })
    })
  })

  it('does not emit error when connection is closed by client', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents([]))

      await withEventSource(server, async es => {
        const errors = startErrorQueue(es)
        await waitForOpenEvent(es)

        es.close()

        await expectNothingReceived(errors)
      })
    })
  })

  it('populates message\'s lastEventId correctly when the last event has an associated id', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['id: 123\ndata: hello\n\n']))

      await withEventSource(server, async es => {
        const messages = startMessageQueue(es)
        const m = await messages.take()
        assert.equal(m.lastEventId, '123')
      })
    })
  })

  it('populates message\'s lastEventId correctly when the last event doesn\'t have an associated id', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['id: 123\ndata: Hello\n\n', 'data: World\n\n']))

      await withEventSource(server, async es => {
        const messages = startMessageQueue(es)

        const m1 = await messages.take()
        assert.equal(m1.lastEventId, '123')

        const m2 = await messages.take()
        assert.equal(m2.lastEventId, '123')
      })
    })
  })

  it('ignores event ID that contains a null', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['id: 12\u00003\ndata: hello\n\n']))

      await withEventSource(server, async es => {
        const messages = startMessageQueue(es)
        const m = await messages.take()
        assert.equal(m.lastEventId, '')
      })
    })
  })

  it('populates messages with enumerable properties so they can be inspected via console.log().', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: World\n\n']))

      await withEventSource(server, async es => {
        const messages = startMessageQueue(es)
        const m = await messages.take()

        const enumerableAttributes = Object.keys(m)
        assert.notEqual(enumerableAttributes.indexOf('data'), -1)
        assert.notEqual(enumerableAttributes.indexOf('type'), -1)
      })
    })
  })

  it('throws error if the message type is unspecified, \'\' or null', async () => {
    await withServer(async server => {
      await withEventSource(server, async es => {
        assert.throws(function () { es.dispatchEvent({}) })
        assert.throws(function () { es.dispatchEvent({type: undefined}) })
        assert.throws(function () { es.dispatchEvent({type: ''}) })
        assert.throws(function () { es.dispatchEvent({type: null}) })
      })
    })
  })

  it('delivers the dispatched event without payload', async () => {
    await withServer(async server => {
      await withEventSource(server, async es => {
        const messages = new AsyncQueue()
        es.addEventListener('greeting', m => messages.add(m))

        es.dispatchEvent({ type: 'greeting' })

        await messages.take()
      })
    })
  })

  it('delivers the dispatched event with payload', async () => {
    await withServer(async server => {
      await withEventSource(server, async es => {
        const messages = new AsyncQueue()
        es.addEventListener('greeting', m => messages.add(m))

        es.dispatchEvent({ type: 'greeting', detail: {data: 'Hello'} })

        const m = await messages.take()
        assert.equal(m.data, 'Hello')
      })
    })
  })
})

describe('Proxying', function () {
  it('proxies http->http requests', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: World\n\n']))

      await withCloseable(TestHttpServers.startProxy, async proxy => {
        await withEventSource(server, { proxy: proxy.url }, async es => {
          await shouldReceiveMessages(es, [
            { data: 'World' }
          ])
        })
      })
    })
  })

  it('proxies https->http requests', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: World\n\n']))

      await withCloseable(TestHttpServers.startSecureProxy, async proxy => {
        await withEventSource(server, { proxy: proxy.url, rejectUnauthorized: false }, async es => {
          await shouldReceiveMessages(es, [
            { data: 'World' }
          ])
        })
      })
    })
  })

  it('can use a tunneling agent with a proxy', async () => {
    await withServer(async server => {
      server.byDefault(writeEvents(['data: World\n\n']))

      await withCloseable(TestHttpServers.startProxy, async proxyServer => {
        const agent = tunnel.httpOverHttp({proxy: {host: proxyServer.hostname, port: proxyServer.port}})

        await withEventSource(server, { agent }, async es => {
          const errors = startErrorQueue(es)

          await shouldReceiveMessages(es, [
            { data: 'World' }
          ])

          assert.equal(proxyServer.requestCount(), 1)
          const req = await proxyServer.nextRequest()
          assert.equal(req.path, server.url)

          if (!errors.isEmpty()) {
            const err = await errors.take()
            throw err
          }
        })
      })
    })
  })
})

describe('read timeout', function () {
  const briefDelay = 1

  function makeStreamHandler (timeBetweenEvents) {
    let requestCount = 0
    return function (req, res) {
      requestCount++
      res.writeHead(200, {'Content-Type': 'text/event-stream'})
      var eventPrefix = 'request-' + requestCount
      res.write('') // turns on chunking
      res.write('data: ' + eventPrefix + '-event-1\n\n')
      setTimeout(() => {
        if (res.writableEnded || res.finished) {
          // don't try to write any more if the connection's already been closed
          return
        }
        res.write('data: ' + eventPrefix + '-event-2\n\n')
      }, timeBetweenEvents)
    }
  }

  it('drops connection if read timeout elapses', async () => {
    const readTimeout = 50
    const timeBetweenEvents = 100
    await withServer(async server => {
      server.byDefault(makeStreamHandler(timeBetweenEvents))

      const opts = {
        initialRetryDelayMillis: briefDelay,
        readTimeoutMillis: readTimeout
      }
      await withEventSource(server, opts, async es => {
        const messagesOrErrors = new AsyncQueue()
        es.onmessage = e => messagesOrErrors.add(e)
        es.onerror = e => messagesOrErrors.add(e)

        const m1 = await messagesOrErrors.take()
        assert.equal(m1.type, 'message')
        assert.equal(m1.data, 'request-1-event-1')

        const err = await messagesOrErrors.take()
        assert.equal(err.type, 'error')
        assert.ok(/^Read timeout/.test(err.message),
          'Unexpected error message: ' + err.message)

        const m2 = await messagesOrErrors.take()
        assert.equal(m2.type, 'message')
        assert.equal(m2.data, 'request-2-event-1')
      })
    })
  })

  it('does not drop connection if read timeout does not elapse', async () => {
    const readTimeout = 100
    const timeBetweenEvents = 50
    await withServer(async server => {
      server.byDefault(makeStreamHandler(timeBetweenEvents))

      const opts = {
        initialRetryDelayMillis: briefDelay,
        readTimeoutMillis: readTimeout
      }
      await withEventSource(server, opts, async es => {
        const messagesOrErrors = new AsyncQueue()
        es.onmessage = e => messagesOrErrors.add(e)
        es.onerror = e => messagesOrErrors.add(e)

        const m1 = await messagesOrErrors.take()
        assert.equal(m1.type, 'message')
        assert.equal(m1.data, 'request-1-event-1')

        const m2 = await messagesOrErrors.take()
        assert.equal(m2.type, 'message')
        assert.equal(m2.data, 'request-1-event-2')

        expectNothingReceived(messagesOrErrors)
      })
    })
  })
})

describe('EventSource object', function () {
  it('declares support for custom properties', function () {
    assert.equal(true, EventSource.supportedOptions.headers)
    assert.equal(true, EventSource.supportedOptions.https)
    assert.equal(true, EventSource.supportedOptions.method)
    assert.equal(true, EventSource.supportedOptions.proxy)
    assert.equal(true, EventSource.supportedOptions.skipDefaultHeaders)
    assert.equal(true, EventSource.supportedOptions.withCredentials)
  })

  it('does not allow supportedOptions to be modified', function () {
    EventSource.supportedOptions.headers = false
    assert.equal(true, EventSource.supportedOptions.headers)
  })
})
