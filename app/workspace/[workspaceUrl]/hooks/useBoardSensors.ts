import {
  useSensors,
  useSensor,
  PointerSensor,
  KeyboardSensor,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

const DND_ACTIVATION_DISTANCE = 5

/**
 * Shared DnD sensor setup for Kanban boards.
 */
export function useBoardSensors() {
  return useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DND_ACTIVATION_DISTANCE },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
}
