const CalculateCapacity = require('../lib/capacity')

const mocha = require('mocha')
const assert = require('assert')
const it = mocha.it

it('Uses the minimum capacity', () => {
  const [resize, newCapacity] = CalculateCapacity(0, 1, 1024 * 1024)
  assert.equal(resize, true)
  assert.equal(newCapacity, Buffer.poolSize)
})

it('Does not increase capacity when there is sufficient capacity', () => {
  const [resize, newCapacity] = CalculateCapacity(1024, 1023, 1024 * 1024)

  assert.equal(resize, false)
  assert.equal(newCapacity, 0)
})

it('Uses exponential doubling capacity scaling', () => {
  // Capacities at or above Buffer.poolSize are unaffected by the minimum-capacity
  // floor, so these exercise pure doubling regardless of the platform's pool size.
  const res1 = CalculateCapacity(Buffer.poolSize, Buffer.poolSize + 1, 1024 * 1024)
  assert.deepEqual(res1, [true, Buffer.poolSize * 2])
  const res2 = CalculateCapacity(Buffer.poolSize * 2, Buffer.poolSize * 2 + 1, 1024 * 1024)
  assert.deepEqual(res2, [true, Buffer.poolSize * 4])
})

it('Uses required capacity when it exceeds doubling', () => {
  const [resize, newCapacity] = CalculateCapacity(Buffer.poolSize, Buffer.poolSize * 4, 1024 * 1024)
  assert.equal(resize, true)
  assert.equal(newCapacity, Buffer.poolSize * 4)
})

it('Does not exceed max over allocation', () => {
  const capacity = 1024 * 1024 * 3
  const maxOverAllocation = 1024 * 1024
  const [resize, newCapacity] = CalculateCapacity(capacity, capacity + 1, 1024 * 1024)
  assert.equal(resize, true)
  assert.equal(newCapacity, capacity + maxOverAllocation + 1)
})
