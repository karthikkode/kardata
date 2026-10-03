// Shared interaction recipes (plan 2.5). One definition per recipe so
// hover, press, and focus stay identical across every surface.

/** Standalone focus ring: buttons, links, inputs outside containers. */
export const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/** In-container focus ring: rows, menu items, tabs, nav, cells. */
export const focusRingInset =
  'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'

/** Input focus: border shift plus a soft ring. */
export const focusRingInput =
  'outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/30'

/** Button press: pointer, fast color motion, subtle scale. */
export const pressable =
  'cursor-pointer transition-all duration-120 ease-out-soft active:scale-[0.98]'

/** Row and nav press: pointer, fast color motion, active fill, no motion. */
export const pressRow =
  'cursor-pointer transition-colors duration-120 ease-out-soft active:bg-surface-active'
