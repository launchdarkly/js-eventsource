# EventSource [![npm version](http://img.shields.io/npm/v/launchdarkly-eventsource.svg?style=flat-square)](http://browsenpm.org/package/launchdarkly-eventsource)[![Circle CI](https://circleci.com/gh/launchdarkly/js-eventsource/tree/master.svg?style=svg)](https://circleci.com/gh/launchdarkly/js-eventsource/tree/master)[![NPM Downloads](https://img.shields.io/npm/dm/laumchdarkly-eventsource.svg?style=flat-square)](http://npm-stat.com/charts.html?package=launchdarkly-eventsource&from=2015-09-01)[![Dependencies](https://img.shields.io/david/launchdarkly/js-eventsource.svg?style=flat-square)](https://david-dm.org/launchdarkly/js-eventsource)

This library is a pure JavaScript implementation of the [EventSource](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events) client. The API aims to be W3C compatible.

You can use it with Node.js or as a browser polyfill for
[browsers that don't have native `EventSource` support](http://caniuse.com/#feat=eventsource).

This is a fork of the original [EventSource](https://github.com/EventSource/eventsource) project by Aslak Hellesøy, with additions to support the requirements of the LaunchDarkly SDKs. Note that as described in the [changelog](CHANGELOG.md), the API is _not_ backward-compatible with the original package, although it can be used with minimal changes.

## Install

    npm install launchdarkly-eventsource

## Example

    npm install
    node ./example/sse-server.js
    node ./example/sse-client.js    # Node.js client
    open http://localhost:8080      # Browser client - both native and polyfill
    curl http://localhost:8080/sse  # Enjoy the simplicity of SSE

## Browser Polyfill

Just add `example/eventsource-polyfill.js` file to your web page:

```html
<script src="/eventsource-polyfill.js"></script>
```

Now you will have two global constructors:

```javascript
window.EventSourcePolyfill
window.EventSource // Unchanged if browser has defined it. Otherwise, same as window.EventSourcePolyfill
```

If you're using [webpack](https://webpack.github.io/) or [browserify](http://browserify.org/)
you can of course build your own. (The `example/eventsource-polyfill.js` is built with webpack).

## Extensions to the W3C API

### Setting HTTP request headers

You can define custom HTTP headers for the initial HTTP request. This can be useful for e.g. sending cookies or to specify an initial `Last-Event-ID` value.

HTTP headers are defined by assigning a `headers` attribute to the optional `eventSourceInitDict` argument:

```javascript
var eventSourceInitDict = {headers: {'Cookie': 'test=test'}};
var es = new EventSource(url, eventSourceInitDict);
```

Normally, EventSource will always add the headers `Cache-Control: no-cache` (since an SSE stream should always contain live content, not cached content), and `Accept: text/event-stream`. This could cause problems if you are making a cross-origin request, since CORS has restrictions on what headers can be sent. To turn off the default headers, so that it will _only_ send the headers you specify, set the `skipDefaultHeaders` option to `true`:

```javascript
var eventSourceInitDict = {
  headers: {'Cookie': 'test=test'},
  skipDefaultHeaders: true
};
var es = new EventSource(url, eventSourceInitDict);
```

### Setting HTTP request method/body

By default, EventSource makes a `GET` request. You can specify a different HTTP verb and/or a request body:

```javascript
var eventSourceInitDict = {method: 'POST', body: 'n=100'};
var es = new EventSource(url, eventSourceInitDict);
```

### Special HTTPS configuration

In Node.js, you can customize the behavior of HTTPS requests by specifying, for instance, additional trusted CA certificates. You may use any of the special TLS options supported by Node's [`tls.connect()`](https://nodejs.org/api/tls.html#tls_tls_connect_options_callback) and [`tls.createSecureContext()`](https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options) (depending on what version of Node you are using) by putting them in an object in the `https` property of your configuration:

```javascript
var eventSourceInitDict = {
  https: {
    rejectUnauthorized: false  // causes requests to succeed even if the certificate cannot be validated
  }
}
var es = new EventSource(url, eventSourceInitDict);
```

This only works in Node.js, not in a browser.

### HTTP status code on error events

Unauthorized and redirect error status codes (for example 401, 403, 301, 307) are available in the `status` property in the error event.

```javascript
es.onerror = function (err) {
  if (err) {
    if (err.status === 401 || err.status === 403) {
      console.log('not authorized');
    }
  }
};
```

### HTTP/HTTPS proxy

You can define a `proxy` option for the HTTP request to be used. This is typically useful if you are behind a corporate firewall.

```javascript
var es = new EventSource(url, {proxy: 'http://your.proxy.com'});
```

## License

MIT-licensed. See LICENSE
