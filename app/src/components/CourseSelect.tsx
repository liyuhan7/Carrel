import { useStore } from '../store'
import type { FileRec } from '../types'
import { Popover } from './Popover'

/** Course label that opens a menu; used for files, sessions and notes. */
export function CourseSelect ({ value, onChange, className = '', label = '课程' }: {
  value: string | null | undefined
  onChange: (courseId: string | null) => void
  className?: string
  label?: string
}) {
  const courses = useStore((s) => s.courses)
  const course = courses.find((item) => item.id === value)
  const name = course?.name ?? '未归类'

  return (
    <Popover
      align="left"
      width={200}
      dismissOnClick
      trigger={() => (
        <span className={`course-tag${className ? ` ${className}` : ''}`} title={`${label}：${name}`}>
          <span className="course-tag-name">{name}</span>
          <span className="course-tag-caret" aria-hidden="true">▾</span>
        </span>
      )}
    >
      <button
        type="button"
        className={`menu-item${!value ? ' is-active' : ''}`}
        onClick={() => onChange(null)}
      >
        <span className="menu-name">未归类</span>
        {!value ? <span className="menu-check">✓</span> : null}
      </button>
      {courses.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`menu-item${value === item.id ? ' is-active' : ''}`}
          onClick={() => onChange(item.id)}
        >
          <span className="menu-name">{item.name}</span>
          {value === item.id ? <span className="menu-check">✓</span> : null}
        </button>
      ))}
    </Popover>
  )
}

/** Course label for a file or a session scope. */
export function courseNameOf (courseId: string | null | undefined, courses: { id: string; name: string }[]): string {
  return courses.find((course) => course.id === courseId)?.name ?? '未归类'
}

export function recentActivity (files: FileRec[], sessions: { updatedAt: number }[], notes: { updatedAt: number }[]): number {
  return Math.max(0, ...files.map((file) => file.lastOpenedAt), ...sessions.map((session) => session.updatedAt), ...notes.map((note) => note.updatedAt))
}
