import type { Score } from './model.ts'
import { multiRestRuns } from './model.ts'

/**
 * An editing session (task 13.5): the working score with an undo and a redo stack. Each `apply` runs an
 * edit on a copy, so an edit that throws changes nothing and leaves no undo step. An edit that breaks a
 * multi-measure rest clears its `multiRest`.
 */
export class EditSession {
  private current: Score
  private undoStack: Score[] = []
  private redoStack: Score[] = []

  constructor(score: Score) {
    this.current = structuredClone(score)
  }

  get score(): Score {
    return this.current
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /**
   * Applies an edit; returns what the edit returned. Throws (changing nothing) when the edit does. With
   * `amend`, the edit carries on the last one (a button held down) and is undone together with it.
   */
  apply<T>(edit: (score: Score) => T, { amend = false }: { amend?: boolean } = {}): T {
    const copy = structuredClone(this.current)
    // The bars that start a multi-measure rest that holds now; `multiRestRuns` is what says so (change more-marks, D2).
    const held = multiRestRuns(copy).map((r) => copy.measures[r.start]!)
    const result = edit(copy)
    // An edit that puts anything into such a run's bars ends it: the bar no longer says it is printed as one symbol.
    const stillHeld = new Set(multiRestRuns(copy).map((r) => copy.measures[r.start]))
    for (const m of held) if (!stillHeld.has(m)) delete m.multiRest
    if (!amend || this.undoStack.length === 0) this.undoStack.push(this.current)
    this.current = copy
    this.redoStack = []
    return result
  }

  undo(): boolean {
    const previous = this.undoStack.pop()
    if (!previous) return false
    this.redoStack.push(this.current)
    this.current = previous
    return true
  }

  redo(): boolean {
    const next = this.redoStack.pop()
    if (!next) return false
    this.undoStack.push(this.current)
    this.current = next
    return true
  }
}
