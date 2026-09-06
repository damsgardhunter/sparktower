import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2, ChevronLeft, ChevronRight, Play, Pause, SkipForward,
  Volume2, VolumeX, Share2, Rocket, Plus, CircleDot, CheckCircle2,
  Flag, CalendarClock, CalendarDays,
} from "lucide-react";

/** One thing that happened (or is due) on a given day. */
export interface CalendarEvent {
  id: string;
  date: string;                 // YYYY-MM-DD
  type: "project_created" | "task_created" | "task_started" | "task_completed"
      | "task_due" | "milestone_due" | "milestone_completed";
  title: string;
  priority: "low" | "medium" | "high" | null;
  taskId: string | null;
  /** The task's position on the board, so a day reads in the same order. */
  taskOrder?: number | null;
  taskStatus?: string | null;
  actor: { userId: string; name: string; avatarUrl: string | null } | null;
}

/**
 * Priority drives the colour of every task line, so the same red/amber/slate
 * reads identically on the board and the calendar.
 */
const PRIORITY_STYLE: Record<string, { dot: string; line: string; label: string }> = {
  high:   { dot: "bg-red-500",   line: "border-l-red-500 bg-red-500/5",     label: "High priority" },
  medium: { dot: "bg-amber-500", line: "border-l-amber-500 bg-amber-500/5", label: "Medium priority" },
  low:    { dot: "bg-slate-400", line: "border-l-slate-400 bg-slate-400/5", label: "Low priority" },
};

/**
 * Finished work reads as green, whatever its priority was.
 *
 * Priority answers "how urgently should I pick this up" — a question that
 * stops applying the moment it's done. Leaving a completed task red made the
 * day look full of outstanding urgent work.
 */
const DONE_STYLE = { dot: "bg-emerald-500", line: "border-l-emerald-500 bg-emerald-500/10", label: "Completed" };

const lineStyle = (e: CalendarEvent) => {
  if (e.type === "task_completed" || e.type === "milestone_completed") return DONE_STYLE;
  return e.priority ? PRIORITY_STYLE[e.priority] : null;
};

const EVENT_META: Record<CalendarEvent["type"], { icon: any; verb: string; tone: string }> = {
  project_created:     { icon: Rocket,        verb: "Project created",  tone: "text-primary" },
  task_created:        { icon: Plus,          verb: "Created",          tone: "text-muted-foreground" },
  task_started:        { icon: CircleDot,     verb: "Started",          tone: "text-blue-500" },
  task_completed:      { icon: CheckCircle2,  verb: "Completed",        tone: "text-emerald-500" },
  task_due:            { icon: CalendarClock, verb: "Due",              tone: "text-orange-500" },
  milestone_due:       { icon: Flag,          verb: "Milestone due",    tone: "text-purple-500" },
  milestone_completed: { icon: Flag,          verb: "Milestone hit",    tone: "text-purple-500" },
};

/** Max lines rendered inside a day square before it collapses to a "+N" hint. */
const MAX_PER_DAY = 10;

/**
 * Custom MIME type for a dragged task.
 *
 * Lowercase because browsers normalise drag types, and specific so a day cell
 * can tell a task drag from a file or a text selection being dropped on it.
 */
export const TASK_DRAG_TYPE = "application/x-sparktower-task";

const iso = (d: Date) => {
  // Local date key, so a task logged at 11pm doesn't jump to tomorrow.
  const off = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return off.toISOString().slice(0, 10);
};

const prettyDate = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

/** Plain-English sentence for one event — also what gets read aloud. */
function describeEvent(e: CalendarEvent): string {
  const meta = EVENT_META[e.type];
  const who = e.actor?.name ? ` by ${e.actor.name}` : "";
  if (e.type === "project_created") return e.title;
  const priority = e.priority ? `${e.priority} priority. ` : "";
  return `${priority}${meta.verb}${who}: ${e.title}`;
}

/**
 * Reads a day's events aloud, one at a time.
 *
 * Uses the browser's built-in speech synthesis, so there's no network call and
 * nothing to configure — but it isn't available everywhere, hence the
 * `supported` guard rather than a dead button. Speaking is cancelled on unmount
 * so navigating away doesn't leave a voice running.
 */
function useReadAloud(events: CalendarEvent[]) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const playingRef = useRef(false);

  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setPlaying(false);
    playingRef.current = false;
  }, [supported]);

  // Reset whenever the day being read changes.
  useEffect(() => {
    stop();
    setIndex(0);
  }, [events, stop]);

  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  const speakFrom = useCallback((start: number) => {
    if (!supported || start >= events.length) {
      setPlaying(false);
      return;
    }
    setIndex(start);
    setPlaying(true);
    playingRef.current = true;

    const utter = new SpeechSynthesisUtterance(describeEvent(events[start]));
    utter.rate = 1;
    utter.onend = () => {
      // Only continue if we weren't paused or restarted in the meantime.
      if (!playingRef.current) return;
      const next = start + 1;
      if (next < events.length) speakFrom(next);
      else { setPlaying(false); playingRef.current = false; }
    };
    window.speechSynthesis.speak(utter);
  }, [events, supported]);

  const toggle = useCallback(() => {
    if (playing) stop();
    else speakFrom(indexRef.current >= events.length ? 0 : indexRef.current);
  }, [playing, stop, speakFrom, events.length]);

  const skip = useCallback(() => {
    const next = Math.min(indexRef.current + 1, Math.max(events.length - 1, 0));
    if (supported) window.speechSynthesis.cancel();
    speakFrom(next);
  }, [speakFrom, supported, events.length]);

  return { supported, playing, index, toggle, skip, stop };
}

function EventLine({ event, compact, draggable, onDragStart }: {
  event: CalendarEvent;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const meta = EVENT_META[event.type];
  const Icon = meta.icon;
  const style = lineStyle(event);
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`flex items-center gap-1.5 border-l-2 pl-1.5 py-0.5 rounded-r ${
        style ? style.line : "border-l-primary/40 bg-primary/5"
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      title={draggable ? `${describeEvent(event)} — drag to another day to change its due date` : describeEvent(event)}
    >
      <Icon className={`h-3 w-3 shrink-0 ${meta.tone}`} />
      <span className={`truncate ${compact ? "text-[10px]" : "text-xs"}`}>{event.title}</span>
      {!compact && event.actor && (
        <UserAvatar src={event.actor.avatarUrl} name={event.actor.name} className="h-4 w-4 ml-auto shrink-0" />
      )}
    </div>
  );
}

export function ProjectCalendar({
  projectId, projectTitle, onShareTask, onOpenTask,
}: {
  projectId: string;
  projectTitle: string;
  /** Opens the composer pre-filled so a finished task can be posted. */
  onShareTask?: (event: CalendarEvent) => void;
  /** Opens the full task, so a day's entries are a way into the work. */
  onOpenTask?: (taskId: string) => void;
}) {
  const { toast } = useToast();
  const [cursor, setCursor] = useState(() => new Date());
  const [openDay, setOpenDay] = useState<string | null>(null);
  /** The day cell currently under a dragged task. */
  const [dropDay, setDropDay] = useState<string | null>(null);

  /**
   * Dragging a task onto a day sets its due date to that day. Reaching for the
   * task, opening it and typing a date is four steps to express something the
   * calendar can already say by position.
   */
  const rescheduleMutation = useMutation({
    mutationFn: async ({ taskId, date }: { taskId: string; date: string }) => {
      await apiRequest("PATCH", `/api/kanban/${taskId}`, { dueDate: date });
      return { date };
    },
    onSuccess: ({ date }) => {
      toast({ title: "Due date moved", description: `Now due ${prettyDate(date)}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
    },
    onError: () => toast({ title: "Couldn't move that task", variant: "destructive" }),
  });

  const { data, isLoading } = useQuery<{ projectCreatedAt: string; events: CalendarEvent[] }>({
    queryKey: ["/api/projects", projectId, "calendar"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/calendar`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the calendar");
      return res.json();
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of data?.events || []) {
      const list = map.get(e.date) || [];
      list.push(e);
      map.set(e.date, list);
    }
    /*
     * A day reads in board order — the sequence Nova set when it ordered the
     * tasks. This used to sort by event type instead, which split a single
     * task's entries apart and put the day in an order that matched nothing
     * the user had seen on the board.
     *
     * Project and milestone entries have no board position, so they sit first
     * as the day's context; then tasks in board order; then each task's own
     * events in the order they actually happened.
     */
    const typeRank: Record<string, number> = {
      project_created: 0, milestone_completed: 1, milestone_due: 2,
      task_created: 3, task_started: 4, task_completed: 5, task_due: 6,
    };
    for (const list of map.values()) {
      list.sort((a, b) =>
        (a.taskId ? 1 : 0) - (b.taskId ? 1 : 0)
        || (a.taskOrder ?? -1) - (b.taskOrder ?? -1)
        || (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9)
        || a.title.localeCompare(b.title));
    }
    return map;
  }, [data]);

  // Month grid, padded to whole weeks starting Sunday.
  const weeks = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay());
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    const out: Date[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    // Drop a trailing all-next-month week so short months don't render blank rows.
    while (out.length > 4 && out[out.length - 1].every((d) => d.getMonth() !== cursor.getMonth())) out.pop();
    return out;
  }, [cursor]);

  const dayEvents = openDay ? byDay.get(openDay) || [] : [];
  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todayKey = iso(new Date());

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const totalThisMonth = [...byDay.entries()]
    .filter(([k]) => new Date(`${k}T12:00:00`).getMonth() === cursor.getMonth())
    .reduce((n, [, v]) => n + v.length, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} title="Previous month" data-testid="button-calendar-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} title="Next month" data-testid="button-calendar-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold ml-2" data-testid="text-calendar-month">{monthLabel}</span>
          <Badge variant="secondary" className="ml-1 text-xs">{totalThisMonth} events</Badge>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {Object.entries(PRIORITY_STYLE).map(([key, s]) => (
            <span key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {key}
            </span>
          ))}
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setCursor(new Date())} data-testid="button-calendar-today">Today</Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-1 py-1 text-center">{d}</div>
        ))}
      </div>

      <div className="space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((day) => {
              const key = iso(day);
              const events = byDay.get(key) || [];
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = key === todayKey;
              const shown = events.slice(0, MAX_PER_DAY);
              const overflow = events.length - shown.length;
              const isDropTarget = dropDay === key;
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={events.length ? 0 : -1}
                  onClick={() => events.length && setOpenDay(key)}
                  onKeyDown={(ev) => {
                    if ((ev.key === "Enter" || ev.key === " ") && events.length) {
                      ev.preventDefault();
                      setOpenDay(key);
                    }
                  }}
                  onDragOver={(ev) => {
                    // Only claim the drop if a task is actually being dragged.
                    if (!ev.dataTransfer.types.includes(TASK_DRAG_TYPE)) return;
                    ev.preventDefault();
                    ev.dataTransfer.dropEffect = "move";
                    if (dropDay !== key) setDropDay(key);
                  }}
                  onDragLeave={() => setDropDay((d) => (d === key ? null : d))}
                  onDrop={(ev) => {
                    const taskId = ev.dataTransfer.getData(TASK_DRAG_TYPE);
                    setDropDay(null);
                    if (!taskId) return;
                    ev.preventDefault();
                    rescheduleMutation.mutate({ taskId, date: key });
                  }}
                  className={`text-left align-top rounded-md border p-1.5 min-h-[7.5rem] transition-colors ${
                    inMonth ? "bg-card" : "bg-muted/30"
                  } ${isDropTarget ? "border-primary ring-2 ring-primary bg-primary/5" : isToday ? "border-primary ring-1 ring-primary/40" : "border-border"} ${
                    events.length ? "hover:border-primary/60 cursor-pointer" : "cursor-default"
                  }`}
                  data-testid={`calendar-day-${key}`}
                  aria-label={`${prettyDate(key)}, ${events.length} events`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-semibold ${inMonth ? "" : "text-muted-foreground/50"} ${isToday ? "text-primary" : ""}`}>
                      {day.getDate()}
                    </span>
                    {events.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">{events.length}</span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {shown.map((e) => (
                      <EventLine
                        key={e.id}
                        event={e}
                        compact
                        draggable={!!e.taskId}
                        onDragStart={(ev) => {
                          if (!e.taskId) return;
                          ev.stopPropagation();
                          ev.dataTransfer.setData(TASK_DRAG_TYPE, e.taskId);
                          ev.dataTransfer.effectAllowed = "move";
                        }}
                      />
                    ))}
                    {overflow > 0 && (
                      <p className="text-[10px] text-muted-foreground pl-1">+{overflow} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <DayDetail
        dayKey={openDay}
        events={dayEvents}
        projectTitle={projectTitle}
        onClose={() => setOpenDay(null)}
        onShareTask={onShareTask}
        onOpenTask={onOpenTask && ((taskId) => {
          // Close the day first — stacking the task dialog on top of this one
          // traps focus and leaves two overlays fighting over the backdrop.
          setOpenDay(null);
          onOpenTask(taskId);
        })}
      />
    </div>
  );
}

/** Expanded view of a single day, with the read-aloud controls. */
function DayDetail({
  dayKey, events, projectTitle, onClose, onShareTask, onOpenTask,
}: {
  dayKey: string | null;
  events: CalendarEvent[];
  projectTitle: string;
  onClose: () => void;
  onShareTask?: (event: CalendarEvent) => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const { supported, playing, index, toggle, skip, stop } = useReadAloud(events);

  const completed = events.filter((e) => e.type === "task_completed");
  const started = events.filter((e) => e.type === "task_started");
  const created = events.filter((e) => e.type === "task_created");

  const close = () => { stop(); onClose(); };

  return (
    <Dialog open={!!dayKey} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            {dayKey ? prettyDate(dayKey) : ""}
          </DialogTitle>
          <DialogDescription>
            {projectTitle} — {events.length} event{events.length === 1 ? "" : "s"}
            {completed.length > 0 && `, ${completed.length} finished`}
            {started.length > 0 && `, ${started.length} picked up`}
            {created.length > 0 && `, ${created.length} added`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-y border-border py-2">
          {supported ? (
            <>
              <Button size="sm" variant={playing ? "default" : "outline"} className="gap-1.5" onClick={toggle} data-testid="button-read-aloud">
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {playing ? "Pause" : "Read this day"}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={skip} disabled={!events.length} data-testid="button-read-skip">
                <SkipForward className="h-3.5 w-3.5" /> Next
              </Button>
              <span className="text-xs text-muted-foreground flex items-center gap-1.5 ml-1">
                {playing ? <Volume2 className="h-3.5 w-3.5 text-primary" /> : <VolumeX className="h-3.5 w-3.5" />}
                {events.length ? `${Math.min(index + 1, events.length)} of ${events.length}` : "nothing to read"}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <VolumeX className="h-3.5 w-3.5" /> Reading aloud isn't supported in this browser.
            </span>
          )}
        </div>

        {/*
          * A plain overflow container, not ScrollArea.
          *
          * Radix's ScrollArea sizes its viewport with h-full, which needs a
          * resolved height from the parent. Inside this flex column it got an
          * auto height instead, so a long day just pushed the dialog past its
          * max height and nothing scrolled. min-h-0 lets the flex child shrink;
          * overflow-y-auto on the element that actually holds the list is what
          * makes it scroll.
          */}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1" data-testid="day-detail-scroll">
          <div className="space-y-2 py-1">
            {events.map((e, i) => {
              const meta = EVENT_META[e.type];
              const Icon = meta.icon;
              const style = lineStyle(e);
              const isDone = e.type === "task_completed" || e.type === "milestone_completed";
              const isReading = playing && i === index;
              // A day's entries are the obvious way into the work, so the
              // ones backed by a live task open it.
              const openable = !!(e.taskId && onOpenTask);
              return (
                <Card
                  key={e.id}
                  className={`border-l-4 ${style ? style.line : "border-l-primary/40"} ${
                    isReading ? "ring-2 ring-primary" : ""
                  } ${openable ? "transition-colors hover:border-primary/60" : ""}`}
                  data-testid={`calendar-event-${e.id}`}
                >
                  <CardContent className="p-3 space-y-1.5">
                    <div className="flex items-start gap-2">
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.tone}`} />
                      {openable ? (
                        <button
                          type="button"
                          className="flex-1 min-w-0 text-left group"
                          onClick={() => onOpenTask!(e.taskId!)}
                          data-testid={`button-open-task-${e.taskId}`}
                        >
                          <p className="text-sm font-medium group-hover:underline decoration-dotted underline-offset-2">
                            {e.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {meta.verb}
                            {style && ` · ${style.label}`}
                            <span className="ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              · open task
                            </span>
                          </p>
                        </button>
                      ) : (
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{e.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {meta.verb}
                            {style && ` · ${style.label}`}
                          </p>
                        </div>
                      )}
                      {isDone
                        ? <Badge variant="secondary" className="text-[10px] shrink-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">done</Badge>
                        : e.priority && <Badge variant="secondary" className="text-[10px] shrink-0">{e.priority}</Badge>}
                    </div>

                    {e.actor && (
                      <div className="flex items-center gap-2 pl-6">
                        <UserAvatar src={e.actor.avatarUrl} name={e.actor.name} className="h-5 w-5" />
                        <span className="text-xs text-muted-foreground">
                          {e.type === "task_completed" ? "Completed by " : e.type === "task_started" ? "Working on it: " : ""}
                          <span className="font-medium text-foreground">{e.actor.name}</span>
                        </span>
                      </div>
                    )}

                    {e.type === "task_completed" && onShareTask && (
                      <div className="pl-6 pt-0.5">
                        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => onShareTask(e)} data-testid={`button-share-task-${e.taskId}`}>
                          <Share2 className="h-3 w-3" /> Share this win
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {events.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">Nothing happened on this day.</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
