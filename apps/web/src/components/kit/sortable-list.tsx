"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";

// One reorderable list. Drag with the mouse or a finger, or: focus the handle, Space to pick
// up, arrow keys to move, Space to drop, Escape to cancel. Each move is announced in words.
// Motion's layout animation is deliberately not used on these items: dnd-kit moves them with
// its own transforms and the two fight.

interface Props<T extends { id: string }> {
  items: T[];
  /** What to call an item when announcing a move: "the question about X". */
  describe: (item: T) => string;
  onReorder: (orderedIds: string[]) => void;
  children: (item: T, handle: HandleProps) => React.ReactNode;
}

export interface HandleProps {
  setRef: (element: HTMLElement | null) => void;
  attributes: React.HTMLAttributes<HTMLElement>;
  listeners: Record<string, unknown> | undefined;
  dragging: boolean;
}

export function SortableList<T extends { id: string }>({
  items,
  describe,
  onReorder,
  children,
}: Props<T>) {
  const sensors = useSensors(
    // A pointer must travel a little before a drag starts, so a click on the handle stays a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const ids = items.map((item) => item.id);
  const position = (id: string | number) => ids.indexOf(String(id)) + 1;
  const name = (id: string | number) =>
    describe(items.find((item) => item.id === String(id))!);

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    onReorder(
      arrayMove(
        ids,
        ids.indexOf(String(active.id)),
        ids.indexOf(String(over.id)),
      ),
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Press Space to pick this up, the arrow keys to move it, Space to drop it, and Escape to cancel.",
        },
        announcements: {
          onDragStart: ({ active }) =>
            `Picked up ${name(active.id)}, position ${position(active.id)} of ${ids.length}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${name(active.id)} is now at position ${position(over.id)} of ${ids.length}.`
              : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? `Dropped ${name(active.id)} at position ${position(over.id)} of ${ids.length}.`
              : `Dropped ${name(active.id)} where it was.`,
          onDragCancel: ({ active }) =>
            `Cancelled. ${name(active.id)} is back at position ${position(active.id)}.`,
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-3">
          {/* An item that arrives after the list is on screen — a regenerated question — fades
              in; items already there, the kept ones, do not move. No layout animation: dnd-kit
              positions items with its own transforms and the two would fight. */}
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <SortableItem key={item.id} id={item.id}>
                {(handle) => children(item, handle)}
              </SortableItem>
            ))}
          </AnimatePresence>
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (handle: HandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <m.li
      ref={setNodeRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-90" : undefined}
    >
      {children({
        setRef: setActivatorNodeRef,
        attributes,
        listeners,
        dragging: isDragging,
      })}
    </m.li>
  );
}

/** The grip a card renders where it wants it. */
export function DragHandle({
  handle: { setRef, attributes, listeners, dragging },
  label,
}: {
  handle: HandleProps;
  label: string;
}) {
  return (
    <button
      ref={setRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-label={label}
      className={`-ml-1 flex h-8 w-6 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
}
