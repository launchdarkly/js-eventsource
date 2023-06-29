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
  const res1 = CalculateCapacity(8192, 8193, 1024 * 1024)
  assert.deepEqual(res1, [true, 16384])
  const res2 = CalculateCapacity(16384, 16385, 1024 * 1024)
  assert.deepEqual(res2, [true, 32768])
})

it('Uses required capacity when it exceeds doubling', () => {
  const [resize, newCapacity] = CalculateCapacity(1024, 16384, 1024 * 1024)
  assert.equal(resize, true)
  assert.equal(newCapacity, 16384)
})

it('Does not exceed max over allocation', () => {
  const capacity = 1024 * 1024 * 3
  const maxOverAllocation = 1024 * 1024
  const [resize, newCapacity] = CalculateCapacity(capacity, capacity + 1, 1024 * 1024)
  assert.equal(resize, true)
  assert.equal(newCapacity, capacity + maxOverAllocation + 1)
})
