const test = require('node:test')
const assert = require('node:assert/strict')

test('Composition Grid calculation: fits within aspect framing geometry', () => {
  const RATIO = {
    '1:1': 1,
    '4:3': 4 / 3,
    '16:9': 16 / 9,
  }

  function computeBox(aspect, width, height) {
    if (aspect === 'full') return { boxW: width, boxH: height, vBar: 0, hBar: 0 }
    const r = RATIO[aspect]
    let boxW = width
    let boxH = width * r
    if (boxH > height) {
      boxH = height
      boxW = height / r
    }
    const vBar = Math.max(0, (height - boxH) / 2)
    const hBar = Math.max(0, (width - boxW) / 2)
    return { boxW, boxH, vBar, hBar }
  }

  const screenW = 1080
  const screenH = 2400

  // 1:1 square crop
  const sq = computeBox('1:1', screenW, screenH)
  assert.equal(sq.boxW, 1080)
  assert.equal(sq.boxH, 1080)
  assert.equal(sq.vBar, (2400 - 1080) / 2)
  assert.equal(sq.hBar, 0)

  // 4:3 vertical crop
  const f3 = computeBox('4:3', screenW, screenH)
  assert.equal(f3.boxW, 1080)
  assert.equal(f3.boxH, 1080 * (4 / 3))
  assert.equal(f3.vBar, (2400 - 1440) / 2)
  assert.equal(f3.hBar, 0)

  // full uses entire viewport
  const full = computeBox('full', screenW, screenH)
  assert.equal(full.boxW, screenW)
  assert.equal(full.boxH, screenH)
  assert.equal(full.vBar, 0)
  assert.equal(full.hBar, 0)
})
