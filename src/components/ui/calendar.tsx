"use client"

import * as React from "react"
import "react-day-picker/style.css"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react"
import {
  DayPicker,
  DayFlag,
  SelectionState,
  UI,
  getDefaultClassNames,
} from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

const defaultClassNames = getDefaultClassNames()

/** กว้างขั้นต่ำ ~7 คอลัมน์ (36×8) — ใช้ w-fit กับ min-w เพื่อไม่ให้โหมดเดิม fit-content บีบจนเหลือคอลัมน์เดียว แต่ไม่ใช้ max-w-none เพราะจะขยายเต็มจอ */
const CAL_MIN_W = "min-w-[288px]"

/**
 * แทนที่ Dropdown ตัวเดิมของ react-day-picker (select โปร่งใส + span ทับ)
 * ให้เป็น <select> มองเห็นได้ — ใน Dialog/Popover คลิกถึงตัวเลือกเดือน/ปีได้แน่นอน
 */
function VisibleNavDropdown({
  className,
  classNames: _classNames,
  components: _components,
  options,
  value,
  onChange,
  disabled,
  style,
  "aria-label": ariaLabel,
}: {
  classNames?: unknown
  components?: unknown
  options?: { value: number; label: string; disabled: boolean }[]
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children">) {
  return (
    <select
      className={cn(
        "relative z-20 h-8 max-w-full shrink-0 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground shadow-sm",
        "cursor-pointer pointer-events-auto",
        className
      )}
      style={style}
      value={value === undefined || value === null ? "" : value}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {options?.map(({ value: v, label, disabled: optDisabled }) => (
        <option key={v} value={v} disabled={optDisabled}>
          {label}
        </option>
      ))}
    </select>
  )
}

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 text-popover-foreground", className)}
      classNames={{
        ...defaultClassNames,
        [UI.Root]: cn(
          defaultClassNames[UI.Root],
          "w-fit max-w-full p-3 text-popover-foreground",
          CAL_MIN_W
        ),
        [UI.Months]: cn(
          defaultClassNames[UI.Months],
          "flex w-fit flex-col gap-4 self-start sm:flex-row sm:gap-4",
          CAL_MIN_W
        ),
        [UI.Month]: cn(defaultClassNames[UI.Month], "w-fit space-y-4", CAL_MIN_W),
        [UI.MonthCaption]: cn(
          defaultClassNames[UI.MonthCaption],
          "flex justify-center px-1 pb-2 pt-1 font-normal"
        ),
        [UI.CaptionLabel]: cn(
          defaultClassNames[UI.CaptionLabel],
          "text-sm font-medium text-popover-foreground"
        ),
        [UI.Dropdowns]: cn(
          defaultClassNames[UI.Dropdowns],
          "flex flex-wrap items-center justify-center gap-2"
        ),
        [UI.DropdownRoot]: cn(
          defaultClassNames[UI.DropdownRoot],
          "min-h-8 rounded-md border border-input bg-background px-2 py-0.5"
        ),
        [UI.Dropdown]: cn(defaultClassNames[UI.Dropdown], "cursor-pointer"),
        [UI.MonthsDropdown]: cn(defaultClassNames[UI.MonthsDropdown], "min-w-[7.5rem]"),
        [UI.YearsDropdown]: cn(defaultClassNames[UI.YearsDropdown], "min-w-[5rem]"),
        [UI.Nav]: cn(
          defaultClassNames[UI.Nav],
          "static inset-auto left-auto right-auto top-auto z-10 mb-2 flex w-full max-w-full items-center justify-between gap-2 px-1"
        ),
        [UI.PreviousMonthButton]: cn(
          buttonVariants({ variant: "outline" }),
          defaultClassNames[UI.PreviousMonthButton],
          "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100"
        ),
        [UI.NextMonthButton]: cn(
          buttonVariants({ variant: "outline" }),
          defaultClassNames[UI.NextMonthButton],
          "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100"
        ),
        [UI.Chevron]: cn(defaultClassNames[UI.Chevron], "h-4 w-4 text-foreground"),
        [UI.MonthGrid]: cn(
          defaultClassNames[UI.MonthGrid],
          "w-full min-w-[288px] caption-bottom border-collapse table-fixed"
        ),
        [UI.Weekdays]: cn(defaultClassNames[UI.Weekdays], ""),
        [UI.Weekday]: cn(
          defaultClassNames[UI.Weekday],
          "px-0 py-1.5 text-center text-[0.65rem] font-normal text-blue-600 dark:text-blue-400 select-none"
        ),
        [UI.Weeks]: cn(defaultClassNames[UI.Weeks], ""),
        [UI.Week]: cn(defaultClassNames[UI.Week], ""),
        [UI.Day]: cn(
          defaultClassNames[UI.Day],
          "relative h-9 w-9 p-0 text-center text-sm [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20 [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected])]:rounded-md [&:has([aria-selected].day-outside)]:bg-accent/50"
        ),
        [UI.DayButton]: cn(
          buttonVariants({ variant: "ghost" }),
          defaultClassNames[UI.DayButton],
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100"
        ),
        [SelectionState.selected]: cn(
          defaultClassNames[SelectionState.selected],
          "[&_button]:bg-primary [&_button]:text-primary-foreground [&_button]:hover:bg-primary [&_button]:hover:text-primary-foreground [&_button]:focus:bg-primary [&_button]:focus:text-primary-foreground"
        ),
        [DayFlag.today]: cn(
          defaultClassNames[DayFlag.today],
          "[&_button]:bg-accent [&_button]:text-accent-foreground"
        ),
        [DayFlag.outside]: cn(
          defaultClassNames[DayFlag.outside],
          "text-muted-foreground [&_button]:text-muted-foreground aria-selected:bg-accent/50 aria-selected:text-muted-foreground"
        ),
        [DayFlag.disabled]: cn(
          defaultClassNames[DayFlag.disabled],
          "text-muted-foreground opacity-50 [&_button]:opacity-50"
        ),
        [DayFlag.hidden]: cn(defaultClassNames[DayFlag.hidden], "invisible"),
        [SelectionState.range_middle]: cn(
          defaultClassNames[SelectionState.range_middle],
          "aria-selected:bg-accent aria-selected:text-accent-foreground"
        ),
        [SelectionState.range_end]: cn(
          defaultClassNames[SelectionState.range_end],
          "day-range-end"
        ),
        ...classNames,
      }}
      components={{
        Dropdown: VisibleNavDropdown,
        Chevron: ({ className, orientation, size: _s, disabled: _d }) => {
          const cls = cn("h-4 w-4 shrink-0", className)
          if (orientation === "left") return <ChevronLeft className={cls} aria-hidden />
          if (orientation === "right") return <ChevronRight className={cls} aria-hidden />
          if (orientation === "down") return <ChevronDown className={cls} aria-hidden />
          if (orientation === "up") return <ChevronUp className={cls} aria-hidden />
          return <ChevronRight className={cls} aria-hidden />
        },
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
