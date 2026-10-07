// What Claude is doing, as the worker reacts to it; `done` is the short
// flourish after a turn's answer.
export type Mode = 'idle' | 'thinking' | 'tool' | 'writing' | 'done'

// What he carries for the running tool: `chores` is his own routine.
export type Gear = 'chores' | 'haul' | 'tag' | 'scan' | 'phone'

// The band's clock: wall time, and the tool time the worker's chores run on.
export type Clock = { now: number; work: number }

// The current mode, how many times Claude has started writing (picks the
// speech-bubble line), and the tool in hand with the gear it calls for.
export type Activity = { mode: Mode; burst: number; tool: string; gear: Gear }

declare module 'claude-code' {
  interface PluginState {
    'princess-auto-theme': {
      frame: Clock
      isRunning: boolean
      activity: Activity
      context: number | null
      fiveHour: number | null
      sevenDay: number | null
    }
  }
}
