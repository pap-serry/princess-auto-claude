import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Activity, Clock, Gear, Mode } from '../types'

const frame = atom({ plugin: 'princess-auto-theme', key: 'frame' } as const, { now: 0, work: 0 } as Clock)
const activity = atom(
  { plugin: 'princess-auto-theme', key: 'activity' } as const,
  { mode: 'idle', burst: 0, tool: '', gear: 'chores' } as Activity,
)
const isRunning = atom({ plugin: 'princess-auto-theme', key: 'isRunning' } as const, false)
const context = atom({ plugin: 'princess-auto-theme', key: 'context' } as const, null)
const fiveHour = atom({ plugin: 'princess-auto-theme', key: 'fiveHour' } as const, null)
const sevenDay = atom({ plugin: 'princess-auto-theme', key: 'sevenDay' } as const, null)

// Princess Auto brand: blue 035A96 (corporate deck); logo blue and red approximate.
const BLUE = '#035A96'
const LOGO_BLUE = '#2F5FAA'
const LIGHT = '#4F9BD6'
const RED = '#D6232A'
const WARN = '#F2A900'

const WIDTH = 12
const TICK_MS = 100
const FLOURISH_MS = 1500 // how long the band lingers on "Done!" after an answer
const TOOL_HOLD_MS = 2000 // a tool's gear stays out at least this long, so quick ones show

// The rolling nut, after the logo: a brushed-steel hex with a cut-out hole and
// white ring, between two grey rails, the wordmark across the middle. The
// desktop draws an Svg as a still image, so the band redraws it every tick
// with the nut posed by the wall clock. Solid fills only, nothing to sanitize.
const NUT_R = 22 // the nut's drawn radius: its 32px shapes at NUT_SCALE
const NUT_SCALE = NUT_R / 32
const NUT_H = 58
const PX_PER_CELL = 9 // over-estimate: an Svg wider than its slot scales down to fit
const SPEED = 224 // px per second along the rails
const PANEL_W = 140 // the usage panel at the strip's right end; the stage is the rest
const NUT_SHAPES = `
      <path fill="#bfc6cd" fill-rule="evenodd" stroke="#7d868f" stroke-width="1.2"
        d="M32,0 L16,27.7 L-16,27.7 L-32,0 L-16,-27.7 L16,-27.7 Z M15,0 A15,15 0 1,0 -15,0 A15,15 0 1,0 15,0 Z"/>
      <path fill="#ffffff" fill-opacity="0.38" fill-rule="evenodd"
        d="M16,-27.7 L-16,-27.7 L-32,0 L-15,0 A15,15 0 0,1 0,-15 Z"/>
      <path fill="#5f6870" fill-opacity="0.35" fill-rule="evenodd"
        d="M-16,27.7 L16,27.7 L32,0 L15,0 A15,15 0 0,1 0,15 Z"/>
      <circle r="21" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="1.6"/>
      <circle r="15" fill="none" stroke="#6f7881" stroke-width="1.4"/>`

// The band's width in px, from its width in cells.
const bandWidth = (columns: number) =>
  Math.round(Math.min(300, Math.max(40, columns || 80)) * PX_PER_CELL)

// Where the nut is at `now`: a round trip across `width` at SPEED, eased at
// each end; a late tick jumps to where the nut should be rather than
// stalling. The angle follows the distance so the nut rolls, not slides.
function poseAt(now: number, width: number) {
  const travel = width - 2 * (NUT_R + 8)
  const period = (2 * travel * 1000) / SPEED
  const phase = (now % period) / period
  const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2
  const eased = t * t * (3 - 2 * t)
  return { x: NUT_R + 8 + travel * eased, angle: ((travel * eased) / NUT_R) * (180 / Math.PI) }
}

// ---- The store worker, in front of the nut ---------------------------------
// He stands on the bottom rail, in front of the rolling nut and the wordmark,
// and reacts to what Claude is doing. While a tool runs he works: his own
// chores (a fresh shuffle each lap: sweep, mop by a wet-floor sign, stock the
// shelf from a pallet and price-gun it) at random spots, carrying the gear
// the tool calls for (a box for Bash, a price gun for edits, a scanner for
// reads and searches, the phone for the web). While Claude thinks he checks
// his clipboard; while it writes he waves; when it answers he gives a thumbs
// up. The chores advance on a work clock that only runs during tool calls, so
// he picks up exactly where he left off.
const SKIN = '#f1c27d'
const SLEEVE = '#024a7c'
const PANTS = '#2b2f36'
const WOOD = '#8a5a2b'
const CARD = '#c8915a'
const DARK = '#3a3a3a'
const RAIL_Y = 50 // the bottom rail's upper edge, where he stands, in front of the nut
const OUTLINE = '#1b1b1b' // keeps him readable over the wordmark
const LAP_S = 30 // seconds of tool time per lap of chores
const WALK_PX_S = 70

const LINES = [
  'Need a hand?',
  'Aisle 7!',
  'Great deals today!',
  'Found it!',
  'Happy hunting!',
  'On it!',
  'Right this way!',
  'Check the flyer!',
]
const PHONE_LINES = ['Let me check…', 'One moment…', 'Yes, in stock!', 'Aisle 12!']

type Chore = 'walk' | 'sweep' | 'mop' | 'stock' | 'price'
type Step = { d: number; k: Chore; from: number; to: number }
type Pt = [number, number]
type Meter = [string, number]

const f1 = (v: number) => v.toFixed(1)
const ease = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const line = (a: Pt, b: Pt, color: string, w: number) =>
  `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`
// A limb over a dark underlay, so he reads against the wordmark.
const limb = (a: Pt, b: Pt, color: string, w: number) => line(a, b, OUTLINE, w + 1.6) + line(a, b, color, w)
const box = (x: number, y: number) =>
  `<rect x="${f1(x)}" y="${f1(y)}" width="10" height="9" fill="${CARD}" stroke="${WOOD}" stroke-width="0.8"/>` +
  line([x + 5, y], [x + 5, y + 3], '#ead7b0', 1.4)
const gun = (h: Pt) => `<rect x="${f1(h[0] - 1)}" y="${f1(h[1] - 3)}" width="6" height="4" rx="1" fill="${DARK}"/>`
const flash = (h: Pt) => `<circle cx="${f1(h[0] + 6)}" cy="${f1(h[1] - 1)}" r="2.2" fill="${RED}" opacity="0.9"/>`
const scanner = (h: Pt) =>
  `<rect x="${f1(h[0] - 1.5)}" y="${f1(h[1] - 2.5)}" width="7" height="4" rx="1" fill="${DARK}"/>` +
  `<rect x="${f1(h[0] + 4)}" y="${f1(h[1] - 1.8)}" width="1.5" height="2.6" fill="${RED}"/>`
const phone = (h: Pt) => `<rect x="${f1(h[0] - 1.2)}" y="${f1(h[1] - 4)}" width="3" height="6" rx="0.8" fill="${DARK}"/>`

// The gear a tool calls for: a box for the shell, the price gun for edits,
// the scanner for reads and searches, the phone for the web.
function gearFor(tool: string): Gear {
  const name = tool.toLowerCase()
  if (name === 'bash' || name === 'powershell') return 'haul'
  if (name === 'edit' || name === 'write' || name === 'multiedit' || name === 'notebookedit') return 'tag'
  if (name === 'read' || name === 'grep' || name === 'glob' || name === 'ls') return 'scan'
  if (/web|browser|chrome|navigate|fetch|search/.test(name)) return 'phone'
  return 'chores'
}

// A tool's name as his label shows it: an MCP tool by its own last part.
const shortTool = (tool: string) => (tool.startsWith('mcp__') ? tool.split('__').pop() ?? tool : tool).slice(0, 14)

// A small seeded generator (mulberry32): one seed, one sequence, so a lap
// draws the same way on every redraw.
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Lap `lap` in px: walk to each chore in a shuffled order, then on to where
// the next lap starts, scaled to last exactly LAP_S.
function lapPlan(lap: number, shelfX: number): Step[] {
  const r = rng(lap * 7919 + 13)
  const lo = 20
  const hi = shelfX - 70
  const startOf = (n: number) => lo + rng(n * 104729 + 7)() * (hi - lo)
  const order = ['sweep', 'mop', 'shelf']
  for (let j = order.length - 1; j > 0; j--) {
    const k = Math.floor(r() * (j + 1))
    const swap = order[j]
    order[j] = order[k]
    order[k] = swap
  }
  const steps: Step[] = []
  let x = startOf(lap)
  const walkTo = (to: number) => {
    steps.push({ d: Math.max(0.4, Math.abs(to - x) / WALK_PX_S), k: 'walk', from: x, to })
    x = to
  }
  for (const chore of order) {
    if (chore === 'shelf') {
      walkTo(shelfX - 6)
      steps.push({ d: 5, k: 'stock', from: x, to: x }, { d: 3, k: 'price', from: x, to: x })
    } else {
      // Keep clear of the shelf: the mop's sign stands 30px to his right.
      walkTo(lo + r() * (hi - 40 - lo))
      if (chore === 'sweep') {
        const to = Math.min(hi - 40, Math.max(lo, x + (r() < 0.5 ? -1 : 1) * (25 + r() * 30)))
        steps.push({ d: 3.5 + r() * 2, k: 'sweep', from: x, to })
        x = to
      } else {
        steps.push({ d: 3.5 + r() * 1.5, k: 'mop', from: x, to: x })
      }
    }
  }
  walkTo(startOf(lap + 1))
  const scale = LAP_S / steps.reduce((sum, c) => sum + c.d, 0)
  return steps.map(c => ({ ...c, d: c.d * scale }))
}

// The worker in his own coordinates: feet at the origin, facing right.
// `step` is the walk phase (null stands still); `tool` is drawn under the
// front arm so his hand sits on it.
function person(step: number | null, front: Pt, back: Pt, tool = '') {
  const swing = step === null ? 2 : 4 * Math.sin(step)
  return [
    limb([-1, -25], back, SLEEVE, 2.6),
    limb([0, -13], [swing, 0], PANTS, 3),
    limb([0, -13], [-swing, 0], PANTS, 3),
    `<rect x="-4" y="-28" width="8" height="16" rx="2" fill="${BLUE}" stroke="${OUTLINE}" stroke-width="0.8"/>`,
    `<rect x="0.6" y="-25" width="2.6" height="1.8" fill="#ffffff"/>`,
    `<circle cy="-33" r="4.6" fill="${SKIN}" stroke="${OUTLINE}" stroke-width="0.8"/>`,
    `<path d="M-4.8,-33.4 A4.8,4.8 0 0,1 4.8,-33.4 L8,-33.4 L8,-32.2 L-4.8,-32.2 Z" fill="${RED}"/>`,
    `<circle cx="2.4" cy="-32.4" r="0.7" fill="#222222"/>`,
    tool,
    limb([1, -25], front, BLUE, 2.6),
    `<circle cx="${f1(front[0])}" cy="${f1(front[1])}" r="1.3" fill="${SKIN}"/>`,
  ].join('')
}

// A speech bubble beside him, on whichever side has room.
function bubble(x: number, width: number, text: string) {
  const w = 10 + text.length * 5.2
  const isLeft = x + 14 + w > width - 8
  const bx = isLeft ? x - 12 - w : x + 12
  const tail = isLeft
    ? `${f1(x - 14)},-27.5 ${f1(x - 19)},-27.5 ${f1(x - 9)},-24`
    : `${f1(x + 14)},-27.5 ${f1(x + 19)},-27.5 ${f1(x + 9)},-24`
  return (
    `<rect x="${f1(bx)}" y="-40" width="${f1(w)}" height="13" rx="5" fill="#ffffff" stroke="#9aa3ab" stroke-width="0.8"/>` +
    `<polygon points="${tail}" fill="#ffffff"/>` +
    `<text x="${f1(bx + w / 2)}" y="-30.8" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="#222222">${text}</text>`
  )
}

// A small mark beside his head while he thinks: a "?" or writing dots.
const tag = (x: number, text: string, size: number, dy = 0) =>
  `<text x="${f1(x + 9)}" y="${f1(-31 + dy)}" font-family="Arial, sans-serif" font-weight="700" font-size="${size}" fill="${LIGHT}">${text}</text>`

// The tool he is on, beside his head on a dark pill so it reads over the shelf.
const toolTag = (x: number, text: string) =>
  `<rect x="${f1(x + 7)}" y="-38.5" width="${f1(text.length * 4.6 + 5)}" height="10" rx="3" fill="${OUTLINE}" opacity="0.8"/>` +
  `<text x="${f1(x + 9.5)}" y="-31" font-family="Arial, sans-serif" font-weight="700" font-size="7.5" fill="${LIGHT}">${text}</text>`

// The worker's scene, in rail coordinates: y 0 is the bottom rail's top, up is
// negative. `work` (ms of tool time) places him in his chores; `now` drives
// the gestures that play while he is stopped.
function workerSvg(work: number, now: number, act: Activity, width: number) {
  const shelfX = Math.round(width * 0.86)
  const tw = work / 1000
  const lap = Math.floor(tw / LAP_S)
  const tl = tw - lap * LAP_S
  const plan = lapPlan(lap, shelfX)
  let start = 0
  let i = plan.length - 1
  let p = 1
  for (let j = 0; j < plan.length; j++) {
    if (tl < start + plan[j].d) {
      i = j
      p = (tl - start) / plan[j].d
      break
    }
    start += plan[j].d
  }
  const c = plan[i]
  const stockI = plan.findIndex(s => s.k === 'stock')
  const stockStart = plan.slice(0, stockI).reduce((sum, s) => sum + s.d, 0)
  const slot = (k: number): Pt => [shelfX + 3 + (k % 2) * 12, k < 2 ? -23 : -35]
  const boardY = (k: number) => (k < 2 ? -14 : -26)

  // The shelf: customers buy last lap's stock and the pallet is delivered on
  // the way to it, he stocks it from the pallet, then tags each box.
  let placed = 4
  let tags = 4
  let delivered = 0
  if (i < stockI) {
    const sold = Math.min(4, Math.floor((4.999 * tl) / Math.max(0.5, stockStart)))
    placed = 4 - sold
    tags = 4 - sold
    delivered = sold
  } else if (i === stockI) {
    placed = Math.min(3, Math.floor(p * 4))
    tags = 0
    delivered = 4 - placed
  } else if (c.k === 'price') {
    tags = Math.min(4, Math.floor(p * 4))
  }

  const { mode, burst, gear } = act
  const isWorking = mode === 'tool'
  const isWalking = c.k === 'walk'
  let x = isWalking || c.k === 'sweep' ? lerp(c.from, c.to, p) : c.from
  let facing = isWalking && c.to < c.from ? -1 : 1
  let body = ''
  let extra = ''
  let holding = false

  if (c.k === 'mop') {
    const sx = c.from + 30
    extra +=
      `<polygon points="${f1(sx)},0 ${f1(sx + 12)},0 ${f1(sx + 6)},-17" fill="#F2C400" stroke="#8a6d00" stroke-width="0.8"/>` +
      `<text x="${f1(sx + 6)}" y="-3" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="9" fill="#222222">!</text>`
  }

  // The routine's own pose for stocking and pricing stands in for the box
  // and the price gun when he is already at the shelf.
  const atShelf = (gear === 'haul' && c.k === 'stock') || (gear === 'tag' && c.k === 'price')
  const isGeared = isWorking && gear !== 'chores' && !atShelf
  const beat = (hz: number) => Math.sin(tw * Math.PI * 2 * hz)

  if (mode === 'done') {
    // The answer is in: a thumbs up.
    facing = 1
    body = person(null, [7, -27], [-1, -15]) + limb([7, -27], [7, -31], SKIN, 1.6)
    extra += bubble(x, width, 'Done!')
  } else if (mode === 'writing') {
    // Claude is writing: he waves, with a fresh line each time it starts.
    facing = 1
    const w = Math.sin((now / 1000) * Math.PI * 2 * 2.5)
    body = person(null, [7 + 2 * w, -37], [-1, -15])
    // Stepping by 5 (coprime with 8 lines) visits every line, never one twice running.
    extra += bubble(x, width, LINES[(burst * 5) % LINES.length])
  } else if (!isWorking) {
    // Claude is thinking: he checks his clipboard, a "?" over his head, and
    // every other beat writes on it.
    facing = 1
    const clip =
      `<rect x="4" y="-26" width="8" height="10" rx="1" fill="${WOOD}"/>` +
      `<rect x="5" y="-24.5" width="6" height="7.5" fill="#f4f4f4"/>` +
      line([6, -22], [10, -22], '#9aa3ab', 0.7) +
      line([6, -20], [10, -20], '#9aa3ab', 0.7)
    const isPondering = Math.floor(now / 1800) % 2 === 0
    const back: Pt = isPondering ? [3, -29.5] : [7 + 2.5 * Math.sin(now / 90), -21]
    body = person(null, [6, -18], back, clip)
    extra += isPondering
      ? tag(x, '?', 12, Math.sin(now / 250))
      : tag(x + 1, '.'.repeat(1 + (Math.floor(now / 300) % 3)), 10)
  } else if (isGeared && isWalking) {
    // Walking between chores with the tool's gear in hand.
    const step = tw * Math.PI * 2 * 2.2
    const s = Math.sin(step)
    if (gear === 'haul') body = person(step, [8, -17], [6, -18], box(3, -21.5))
    else if (gear === 'tag') body = person(step, [7, -20], [-1 + 3 * s, -15], gun([7, -20]))
    else if (gear === 'scan') body = person(step, [9, -21], [-1 + 3 * s, -15], scanner([9, -21]))
    else body = person(step, [5.5, -31], [-1 + 3 * s, -15], phone([5.5, -31]))
  } else if (isGeared) {
    // Stopped with the tool's gear: the job it stands for, in place.
    const cyc = (tw * 1.25) % 1
    if (gear === 'haul') {
      // Lift a box and set it down again.
      const h = lerp(-12, -24, (beat(0.8) + 1) / 2)
      body = person(null, [9, h], [6, h + 1], box(4, h - 4.5))
    } else if (gear === 'tag') {
      // Price-gun a box at his feet.
      const front: Pt = [12, -12]
      body = person(null, front, [-1, -15], box(12, -9) + gun(front) + (cyc > 0.55 && cyc < 0.8 ? flash(front) : ''))
    } else if (gear === 'scan') {
      // Scan a box at his feet: the red beam, on for most of each beep.
      const front: Pt = [9, -21]
      const beam = cyc < 0.7 ? line([15, -20], [19, -6], RED, 0.8) : ''
      body = person(null, front, [-1, -15], box(14, -9) + beam + scanner(front))
    } else {
      // On the store phone, talking with his free hand.
      const w = beat(1.6)
      body = person(null, [5.5, -31], [-3 + 2 * w, -18 - 2 * w], phone([5.5, -31]))
      extra += bubble(x, width, PHONE_LINES[Math.floor(now / 2500) % PHONE_LINES.length])
    }
  } else if (isWalking) {
    const step = tw * Math.PI * 2 * 2.2
    const s = Math.sin(step)
    body = person(step, [1 - 3 * s, -15], [-1 + 3 * s, -15])
  } else if (c.k === 'sweep' || c.k === 'mop') {
    const w = beat(1.4)
    const F: Pt = [14 + 6 * w, 0]
    const T: Pt = [2 + 2 * w, -30]
    const on = (k: number): Pt => [lerp(T[0], F[0], k), lerp(T[1], F[1], k)]
    let tool = ''
    if (c.k === 'sweep') {
      const puff = 0.6 * Math.abs(Math.cos(tw * Math.PI * 2 * 1.4))
      tool =
        [0, 1, 2]
          .map(k => `<circle cx="${f1(F[0] + 7 + k * 3)}" cy="${f1(-2 - k * 2.5)}" r="${f1(1.5 - k * 0.3)}" fill="#cfc6b8" opacity="${f1(puff)}"/>`)
          .join('') +
        line(T, F, WOOD, 1.6) +
        `<polygon points="${f1(F[0] - 5)},0 ${f1(F[0] + 5)},0 ${f1(F[0] + 2.5)},-4 ${f1(F[0] - 2.5)},-4" fill="#d9a441"/>`
    } else {
      tool =
        `<ellipse cx="${f1(F[0])}" cy="0.4" rx="11" ry="1.6" fill="#7fb8e6" opacity="0.45"/>` +
        line(T, F, WOOD, 1.6) +
        `<ellipse cx="${f1(F[0])}" cy="-1.2" rx="6" ry="2" fill="#e9e9e9"/>`
    }
    body = person(null, on(0.55), on(0.3), tool)
  } else if (c.k === 'stock') {
    const c4 = Math.min(3.999, p * 4)
    const k = Math.floor(c4)
    const f = c4 - k
    if (f < 0.4) {
      // Turn to the pallet behind him and reach for the top box.
      facing = -1
      const top = -2 - 9 * (4 - k)
      const r = ease(f / 0.4)
      body = person(null, [lerp(6, 15, r), lerp(-17, top + 4, r)], [-2, -15])
    } else {
      // Turn back and lift it onto its slot.
      holding = true
      const g = ease((f - 0.4) / 0.6)
      const [sx0, sy0] = slot(k)
      const target: Pt = [sx0 + 5 - x, sy0 + 4.5]
      const front: Pt = [lerp(7, target[0], g), lerp(-18, target[1], g)]
      const back: Pt = [lerp(5, target[0] - 3, g), lerp(-17, target[1] + 2, g)]
      body = person(null, front, back, box(front[0] - 5, front[1] - 4.5))
    }
  } else {
    // Price-gun each box: reach to its tag spot, beep, and the tag appears.
    const c4 = Math.min(3.999, p * 4)
    const k = Math.floor(c4)
    const f = c4 - k
    const target: Pt = [slot(k)[0] + 2 - x, boardY(k) - 3]
    const g = ease(Math.min(1, f / 0.5))
    const front: Pt = [lerp(8, target[0], g), lerp(-18, target[1], g)]
    body = person(null, front, [-1, -15], gun(front) + (f > 0.6 && f < 0.85 ? flash(front) : ''))
  }

  // The tool he is on, beside his head (the phone has its bubble instead).
  if (isWorking && act.tool && !(isGeared && !isWalking && gear === 'phone')) {
    extra += toolTag(x, act.tool)
  }

  const stack = Math.max(0, delivered - (holding ? 1 : 0))
  let world =
    `<g fill="${WOOD}">` +
    `<rect x="${shelfX}" y="-38" width="2" height="38"/><rect x="${shelfX + 27}" y="-38" width="2" height="38"/>` +
    `<rect x="${shelfX}" y="-14" width="29" height="1.6"/><rect x="${shelfX}" y="-26" width="29" height="1.6"/>` +
    `<rect x="${shelfX}" y="-38" width="29" height="1.6"/><rect x="${shelfX - 27}" y="-2" width="12" height="2"/></g>`
  for (let k = 0; k < placed; k++) world += box(slot(k)[0], slot(k)[1])
  for (let k = 0; k < tags; k++) world += `<rect x="${slot(k)[0] + 2}" y="${boardY(k) - 0.4}" width="6" height="2.6" fill="${RED}"/>`
  for (let j = 0; j < stack; j++) world += box(shelfX - 26, -2 - 9 * (j + 1))

  const guy = `<g transform="translate(${f1(x)} 0) scale(${facing} 1)">${body}</g>`
  return `<g transform="translate(0 ${RAIL_Y})">${world}${guy}${extra}</g>`
}

// ---- Usage gauges -----------------------------------------------------------
// Slim rounded gauges in place of block characters: brand blue while healthy,
// amber from 70%, red from 90%.
const GAUGE_W = 70
const meterTone = (pct: number) => (pct >= 90 ? RED : pct >= 70 ? WARN : '#3D8FD6')

// One gauge: label, track and fill, percentage; 120px wide from `x`.
function meter([label, pct]: Meter, x: number, cy: number) {
  const tone = meterTone(pct)
  const fill = Math.max(5, (Math.min(100, pct) / 100) * GAUGE_W)
  return (
    `<text x="${x}" y="${f1(cy + 3)}" font-family="Arial, sans-serif" font-size="8.5" fill="#9fb4c8">${label}</text>` +
    `<rect x="${x + 22}" y="${f1(cy - 2.5)}" width="${GAUGE_W}" height="5" rx="2.5" fill="#33404f"/>` +
    `<rect x="${x + 22}" y="${f1(cy - 2.5)}" width="${f1(fill)}" height="5" rx="2.5" fill="${tone}"/>` +
    `<text x="${x + 22 + GAUGE_W + 28}" y="${f1(cy + 3)}" text-anchor="end" font-family="Arial, sans-serif" font-size="8.5" font-weight="700" fill="${tone}">${Math.round(pct)}%</text>`
  )
}

const WAITING = `<text font-family="Arial, sans-serif" font-size="8.5" fill="#9fb4c8"`

// The panel at the strip's right end, between the rails: one gauge a row.
function usagePanel(meters: Meter[], width: number) {
  const px = width - PANEL_W
  const body = meters.length
    ? meters.map((m, k) => meter(m, px + 6, 29.5 - (meters.length - 1) * 5 + k * 10)).join('')
    : `${WAITING} x="${px + 66}" y="32" text-anchor="middle">waiting for usage…</text>`
  return `<rect x="${px}" y="12" width="${PANEL_W - 8}" height="35" rx="5" fill="#1c2430" stroke="#3a4656" stroke-width="0.8"/>${body}`
}

// The idle row: the same gauges side by side under a "Usage" label.
function usageSvg(meters: Meter[]) {
  const width = 48 + Math.max(1, meters.length) * 132
  const body = meters.length
    ? meters.map((m, k) => meter(m, 48 + k * 132, 8)).join('')
    : `${WAITING} x="48" y="11">waiting for first reply…</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="16" viewBox="0 0 ${width} 16">
  <text x="2" y="11.5" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="${LIGHT}">Usage</text>
  <rect x="36" y="2.5" width="2.5" height="11" rx="1" fill="${RED}"/>
  ${body}
</svg>`
}

const usageAlt = (meters: Meter[]) =>
  meters.length ? `Usage: ${meters.map(([l, p]) => `${l} ${Math.round(p)}%`).join(', ')}` : 'Usage: waiting'

// The whole strip: rails, the nut and wordmark across the stage, the worker in
// front, and the usage panel at the right end.
function nutSvg(clock: Clock, act: Activity, width: number, meters: Meter[]) {
  const stage = width - PANEL_W
  const { x, angle } = poseAt(clock.now, stage)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${NUT_H}" viewBox="0 0 ${width} ${NUT_H}">
  <rect x="8" y="6" width="${width - 16}" height="3" rx="1.5" fill="#a7afb7"/>
  <rect x="8" y="50" width="${width - 16}" height="3" rx="1.5" fill="#a7afb7"/>
  <g transform="translate(${x.toFixed(1)} 29.5) rotate(${angle.toFixed(1)}) scale(${NUT_SCALE})">${NUT_SHAPES}</g>
  <text x="${stage / 2}" y="38" text-anchor="middle" font-family="Montserrat, Arial Black, Arial, sans-serif"
    font-weight="800" font-size="24" letter-spacing="0.5" fill="${LOGO_BLUE}">PRINCESS AUTO</text>
  ${workerSvg(clock.work, clock.now, act, stage)}
  ${usagePanel(meters, width)}
</svg>`
}

// Bar colour for the terminal's text bars.
const tone = (pct: number) => (pct >= 90 ? RED : pct >= 70 ? WARN : BLUE)

const bar = (pct: number) => {
  const filled = Math.round((Math.min(100, pct) / 100) * WIDTH)
  return '█'.repeat(filled) + '░'.repeat(WIDTH - filled)
}

// Terminal fallback: a small nut sliding along a rail, a triangle wave.
const bounce = (tick: number, span: number) => {
  const period = span * 2
  const t = tick % period
  return t <= span ? t : period - t
}

async function refresh($: any) {
  let u
  try {
    u = await $.session.usage()
  } catch (err) {
    $.ui.status('PA theme: usage unavailable')
    return
  }
  await update($, context, () => u.context.percent ?? null)
  const pick = (k: string) =>
    u.rateLimits.find((r: { kind: string }) => r.kind === k)?.percentUsed ?? null
  await update($, fiveHour, () => pick('five_hour'))
  await update($, sevenDay, () => pick('seven_day'))
}

// While a tool's gear is held out (until `holdUntil`), a switch to thinking or
// writing waits in `pendingMode`; the timer applies it once the hold is up.
let holdUntil = 0
let pendingMode: Mode | null = null

// Switch what the worker reacts to; a new spell of writing counts a burst.
async function setMode($: any, mode: Mode) {
  try {
    const act = await read($, activity)
    if (act.mode === mode) {
      pendingMode = null
      return
    }
    if ((mode === 'thinking' || mode === 'writing') && act.mode === 'tool' && (await $.clock.now()) < holdUntil) {
      pendingMode = mode
      return
    }
    pendingMode = null
    await update($, activity, a => ({ ...a, mode, burst: mode === 'writing' ? a.burst + 1 : a.burst }))
  } catch (err) {
    // A missed switch only leaves him in the last pose.
  }
}

// Put him to work on `tool`, with the gear it calls for.
async function setTool($: any, tool: string) {
  try {
    const label = shortTool(tool)
    holdUntil = (await $.clock.now()) + TOOL_HOLD_MS
    pendingMode = null
    const act = await read($, activity)
    if (act.mode === 'tool' && act.tool === label) return
    await update($, activity, a => ({ ...a, mode: 'tool', tool: label, gear: gearFor(tool) }))
  } catch (err) {
    // A missed switch only leaves him in the last pose.
  }
}

export const register: Register = on => {
  let stop: (() => void) | null = null
  let work = 0
  let lastTick = 0
  let doneAt = 0
  let toolsRunning = 0

  on('session.start', async ($, e, next) => {
    await refresh($)
    // Drives the strip's redraws; ticks only while a turn runs or its flourish plays.
    stop = $.clock.every(TICK_MS, () => {
      void (async () => {
        if (!(await read($, isRunning))) {
          lastTick = 0
          return
        }
        const now = await $.clock.now()
        if (pendingMode && now >= holdUntil) await setMode($, pendingMode)
        const act = await read($, activity)
        if (act.mode === 'done' && now - doneAt > FLOURISH_MS) {
          await setMode($, 'idle')
          await update($, isRunning, () => false)
          return
        }
        if (lastTick && act.mode === 'tool') work += Math.min(500, now - lastTick)
        lastTick = now
        await update($, frame, () => ({ now, work }))
      })()
    })
    return next(e)
  })

  // Usage moves after every response; hold the gauges' figures until the turn
  // ends so they don't jump about mid-turn.
  on('session.measure', async ($, e, next) => {
    if (!(await read($, isRunning))) await refresh($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    toolsRunning = 0
    holdUntil = 0
    await update($, isRunning, () => true)
    await setMode($, 'thinking')
    return next(e)
  })

  // Each model response, chunk by chunk: thinking, writing, or starting a
  // tool call (its name says which gear he picks up). The chunks pass
  // through untouched.
  on('turn.step', async function* ($, e, next) {
    await setMode($, 'thinking')
    for await (const chunk of next(e)) {
      if (chunk.kind === 'tool') await setTool($, chunk.name)
      else if (chunk.kind === 'input') await setMode($, 'tool')
      else if (chunk.kind === 'thinking') await setMode($, 'thinking')
      else if (chunk.kind === 'text') await setMode($, 'writing')
      yield chunk
    }
  })

  // A tool running: its chore until the last running tool returns, then back to thinking.
  on('tool.call', async ($, e, next) => {
    toolsRunning += 1
    await setTool($, e.tool)
    try {
      return await next(e)
    } finally {
      toolsRunning = Math.max(0, toolsRunning - 1)
      if (toolsRunning === 0) await setMode($, 'thinking')
    }
  })

  // The main loop's turn is over (a subagent's run is not): a short "Done!"
  // after an answer, then the band drops back to the usage row.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    toolsRunning = 0
    if (e.reason === 'answer') {
      doneAt = await $.clock.now()
      await setMode($, 'done')
    } else {
      await setMode($, 'idle')
      await update($, isRunning, () => false)
    }
    await refresh($)
    return next(e)
  })

  // Band above the prompt: the strip while a turn runs (and for its
  // flourish), the usage row otherwise.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ctx = await read($, context)
    const five = await read($, fiveHour)
    const seven = await read($, sevenDay)
    const act = await read($, activity)
    const running = e.props.isWorking || act.mode === 'done'

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      const meters: Meter[] = []
      if (ctx !== null) meters.push(['ctx', ctx])
      if (five !== null) meters.push(['5h', five])
      if (seven !== null) meters.push(['7d', seven])
      if (!running) return <Svg source={usageSvg(meters)} alt={usageAlt(meters)} />
      const clock = await read($, frame)
      return (
        <Svg
          source={nutSvg(clock, act, bandWidth(e.props.bodyColumns), meters)}
          alt={`Princess Auto worker and rolling nut while Claude works. ${usageAlt(meters)}`}
        />
      )
    }

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      const cell = (label: string, pct: number | null) =>
        pct === null ? null : (
          <Text key={label}>
            <Text color={LIGHT}>{label} </Text>
            <Text color={tone(pct)}>{bar(pct)}</Text>
            <Text color={tone(pct)}> {Math.round(pct)}%  </Text>
          </Text>
        )
      const stats = (
        <Box>
          <Text color={BLUE} bold>Usage </Text>
          <Text color={RED}>▎</Text>
          <Text> </Text>
          {cell('ctx', ctx)}
          {cell('5h', five)}
          {cell('7d', seven)}
        </Box>
      )
      if (!running) return stats
      const n = (await read($, frame)).now
      const span = Math.max(8, (e.props.bodyColumns ?? 60) - 4)
      const pos = bounce(Math.floor(n / TICK_MS), span)
      const rail = '─'.repeat(pos) + '⬢' + '─'.repeat(span - pos)
      return (
        <Box flexDirection="column">
          <Text color="#A7AFB7">{rail}</Text>
          {stats}
        </Box>
      )
    }

    return next(e)
  })
}
