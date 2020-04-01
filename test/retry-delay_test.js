var mocha = require('mocha');
var assert = require('assert');
var it = mocha.it;
var describe = mocha.describe;

var retryDelay = require('../lib/retry-delay');
var RetryDelayStrategy = retryDelay.RetryDelayStrategy;

function assertRange(min, max, value) {
  if (value < min || value > max) {
    throw new Error('' + value + ' was not in range [' + min + ', ' + max + ']');
  }
}
  
describe('retry delay', function() {
  it('can return fixed delay with no backoff or jitter', function() {
    var d0 = 1000;
    var r = new RetryDelayStrategy(d0, 0);
    var t0 = (new Date()).getTime() - 10000;
    var d1 = r.nextRetryDelay(t0);
    var d2 = r.nextRetryDelay(t0 + 1000);
    var d3 = r.nextRetryDelay(t0 + 2000);
    assert.equal(d0, d1);
    assert.equal(d0, d2);
    assert.equal(d0, d3);
  });

  it('can use backoff without jitter', function() {
    var d0 = 10000;
    var max = 60000;
    var r = new RetryDelayStrategy(d0, 0, retryDelay.defaultBackoff(max));
    var t0 = (new Date()).getTime() - 10000;
    var d1 = r.nextRetryDelay(t0);
    var d2 = r.nextRetryDelay(t0 + 1000);
    var d3 = r.nextRetryDelay(t0 + 2000);
    var d4 = r.nextRetryDelay(t0 + 3000);
    assert.equal(d0, d1);
    assert.equal(d0 * 2, d2);
    assert.equal(d0 * 4, d3);
    assert.equal(max, d4);
  });

  it('can use jitter without backoff', function() {
    var d0 = 1000;
    var r = new RetryDelayStrategy(d0, 0, null, retryDelay.defaultJitter(0.5));
    var t0 = (new Date()).getTime() - 10000;
    var d1 = r.nextRetryDelay(t0);
    var d2 = r.nextRetryDelay(t0 + 1000);
    var d3 = r.nextRetryDelay(t0 + 2000);
    assertRange(d0 / 2, d0, d1);
    assertRange(d0 / 2, d0, d2);
    assertRange(d0 / 2, d0, d3);
  });

  it('can use jitter with backoff', function() {
    var d0 = 10000;
    var max = 60000;
    var r = new RetryDelayStrategy(d0, 0, retryDelay.defaultBackoff(max), retryDelay.defaultJitter(0.5));
    var t0 = (new Date()).getTime() - 10000;
    var d1 = r.nextRetryDelay(t0);
    var d2 = r.nextRetryDelay(t0 + 1000);
    var d3 = r.nextRetryDelay(t0 + 2000);
    var d4 = r.nextRetryDelay(t0 + 3000);
    assertRange(d0 / 2, d0, d1);
    assertRange(d0, d0 * 2, d2);
    assertRange(d0 * 2, d0 * 4, d3);
    assertRange(max / 2, max, d4);
  });

  it('can reset backoff based on reset interval', function() {
    var d0 = 10000;
    var max = 60000;
    var resetInterval = 45000;
    var r = new RetryDelayStrategy(d0, resetInterval, retryDelay.defaultBackoff(max));
    var t0 = (new Date()).getTime() - 10000;
    r.setGoodSince(t0);

    var t1 = t0 + 1000;
    var d1 = r.nextRetryDelay(t1);
    assert.equal(d0, d1);

    var t2 = t1 + d1;
    r.setGoodSince(t2);

    var t3 = t2 + 10000;
    d2 = r.nextRetryDelay(t3);
    assert.equal(d0 * 2, d2);

    var t4 = t3 + d2;
    r.setGoodSince(t4);

    var t5 = t4 + resetInterval;
    var d3 = r.nextRetryDelay(t5);
    assert.equal(d0, d3);
  });

  it('correctly handles backoff & jitter with high retry count', function() {
    // This test verifies that we don't get numeric overflow errors due to using a very high exponential
    // backoff; that should not be a concern in floating point, but this is a sanity check that we're
    // not doing anything that somehow uses fixed integer precision.
    var d0 = 1000;
    var max = 1000 * 60 * 60 * 24 * 365 * 200; // 200 years
    var retryCount = 35; // 2^35 seconds
    var r = new RetryDelayStrategy(d0, 0, retryDelay.defaultBackoff(max), retryDelay.defaultJitter(0.5));

    var d1;
    for (var i = 0; i < retryCount; i++) {
      d1 = r.nextRetryDelay(new Date().getTime());
    }
    assertRange(max / 2, max, d1);
  });
});
