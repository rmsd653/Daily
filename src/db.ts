import Dexie, { Table } from 'dexie';
import { Task, RecurringTemplate, TaskStatus, RecurrenceFrequency, Routine, RoutineInstance } from './types';

export class TaskDatabase extends Dexie {
  tasks!: Table<Task, string>;
  recurring_templates!: Table<RecurringTemplate, string>;
  routines!: Table<Routine, string>;
  routine_instances!: Table<RoutineInstance, string>;

  constructor() {
    super('TaskDatabase');
    this.version(1).stores({
      tasks: 'id, target_date, status, recurring_template_id, created_at',
      recurring_templates: 'id, frequency'
    });
    this.version(2).stores({
      tasks: 'id, target_date, status, recurring_template_id, created_at',
      recurring_templates: 'id, frequency',
      routines: 'id, is_active, start_date, created_at',
      routine_instances: 'id, routine_id, date, status'
    });
  }
}

export const db = new TaskDatabase();

// -------------------------------------------------------------
// Core Date Utilities (User Local Timezone Safe)
// -------------------------------------------------------------

export function getLocalTodayDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToDate(dateStr: string, days: number): string {
  const [yr, mo, dy] = dateStr.split('-').map(Number);
  const date = new Date(yr, mo - 1, dy);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addMonthToDate(dateStr: string): string {
  const [yr, mo, dy] = dateStr.split('-').map(Number);
  const date = new Date(yr, mo - 1, dy);
  date.setMonth(date.getMonth() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// -------------------------------------------------------------
// Safe UUID Engine fallback (avoiding restrictions in iframe sandboxes)
// -------------------------------------------------------------
export function getSafeUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (e) {
    // Ignore sandbox errors
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// -------------------------------------------------------------
// Background Notification & Alarm Scheduling Engine
// -------------------------------------------------------------

// Ask for notification permission if needed
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (!('Notification' in window) || typeof Notification === 'undefined') {
      console.warn('This browser does not support browser system notifications.');
      return false;
    }
    if (Notification.permission === 'granted') {
      return true;
    }
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
  } catch (err) {
    console.warn('Notification permission query blocked or threw an error:', err);
  }
  return false;
}

// Store already fired notifications locally to prevent repeat chimes
const firedNotifications = new Set<string>();

export function fireSystemNotification(taskId: string, title: string, remark?: string) {
  if (firedNotifications.has(taskId)) return;
  firedNotifications.add(taskId);

  // 1. Play sound chime using standard Web Audio Synthesis (No external file needed)
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      const audioCtx = new AudioContextClass();
      
      // Classic elegant triple chime chords
      const playChimeNode = (delay: number, pitch: number, len: number) => {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(pitch, audioCtx.currentTime + delay);
        
        gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime + delay);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + len);
        
        osc.start(audioCtx.currentTime + delay);
        osc.stop(audioCtx.currentTime + delay + len);
      };

      playChimeNode(0, 523.25, 0.4); // C5
      playChimeNode(0.15, 659.25, 0.4); // E5
      playChimeNode(0.3, 783.99, 0.6); // G5
    }
  } catch (e) {
    console.error('Audio synthesizer blocked or uninitialized', e);
  }

  // 2. System level OS notification
  try {
    if ('Notification' in window && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const notification = new Notification(`Task Reminder: ${title}`, {
        body: remark || "You have a task scheduled for now!",
        icon: '/icon.svg',
        tag: taskId,
        requireInteraction: true
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }
  } catch (err) {
    console.warn('Notification instantiation failed or blocked:', err);
  }

  // 3. Attempt service worker notification fallback (for background/closed triggers)
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'SCHEDULED_NOTIFICATION',
      title: `Task Reminder: ${title}`,
      options: {
        body: remark || "You have a task scheduled for now!",
        tag: taskId
      }
    });
  }
}

// -------------------------------------------------------------
// Core Functional Services
// -------------------------------------------------------------

/**
 * Creating a Task
 * If the recurrence frequency is NOT none, we create a core RecurringTemplate profile,
 * and link the initial task instance to the profile.
 */
export async function createTask(
  title: string,
  target_date: string,
  remark: string,
  reminder_time?: string, // In 'HH:mm' format
  status: TaskStatus = 'pending',
  frequency: RecurrenceFrequency = 'none',
  custom_gap_days?: number
): Promise<Task> {
  const now = new Date().toISOString();
  const taskId = getSafeUUID();
  let recurring_template_id: string | undefined = undefined;

  // Validate custom gap
  const gap = frequency === 'custom_gap' ? Math.max(1, custom_gap_days || 1) : undefined;

  if (frequency !== 'none') {
    const templateId = getSafeUUID();
    const template: RecurringTemplate = {
      id: templateId,
      title,
      remark,
      frequency,
      custom_gap_days: gap,
      last_generated_date: target_date,
      created_at: now
    };
    await db.recurring_templates.add(template);
    recurring_template_id = templateId;
  }

  const newTask: Task = {
    id: taskId,
    title,
    remark: remark.trim() || undefined,
    target_date,
    status,
    created_at: now,
    updated_at: now,
    is_synced: false,
    recurring_template_id
  };

  // Convert "HH:mm" time widget input into absolute Iso reminder timestamp
  if (reminder_time && reminder_time.trim()) {
    newTask.reminder_time = `${target_date}T${reminder_time}`; // e.g., "2026-06-22T15:30"
  }

  await db.tasks.add(newTask);
  return newTask;
}

/**
 * Completing a Task
 * Marks a task as completed. If linked to a repetition profile, calculates
 * and auto-inserts the next pending instance into the database.
 */
export async function completeTask(taskId: string): Promise<string | null> {
  const task = await db.tasks.get(taskId);
  if (!task) return null;

  const now = new Date().toISOString();
  await db.tasks.update(taskId, {
    status: 'completed',
    updated_at: now
  });

  let nextTaskDate: string | null = null;

  // Recurrence generator check
  if (task.recurring_template_id) {
    const template = await db.recurring_templates.get(task.recurring_template_id);
    if (template && template.frequency !== 'none') {
      let nextDate = '';
      if (template.frequency === 'daily') {
        nextDate = addDaysToDate(task.target_date, 1);
      } else if (template.frequency === 'weekly') {
        nextDate = addDaysToDate(task.target_date, 7);
      } else if (template.frequency === 'monthly') {
        nextDate = addMonthToDate(task.target_date);
      } else if (template.frequency === 'custom_gap') {
        const gap = template.custom_gap_days || 0;
        nextDate = addDaysToDate(task.target_date, gap + 1); // skip n days means Day + n + 1
      }

      if (nextDate) {
        nextTaskDate = nextDate;
        const nextTaskId = getSafeUUID();
        const nextTask: Task = {
          id: nextTaskId,
          title: template.title,
          remark: template.remark,
          target_date: nextDate,
          status: 'pending',
          created_at: now,
          updated_at: now,
          is_synced: false,
          recurring_template_id: template.id
        };

        // If previous task had an alarm trigger, copy the same HH:mm portion to the next target date
        if (task.reminder_time) {
          try {
            const timeParts = task.reminder_time.split('T');
            if (timeParts.length > 1) {
              nextTask.reminder_time = `${nextDate}T${timeParts[1]}`;
            }
          } catch (e) {
            console.error("Could not forward custom event reminder", e);
          }
        }

        await db.tasks.add(nextTask);

        // Update the recurrence template tracker index
        await db.recurring_templates.update(template.id, {
          last_generated_date: nextDate
        });
      }
    }
  }

  return nextTaskDate;
}

/**
 * Move a task to tomorrow (+1 target_date)
 */
export async function deferTask(taskId: string): Promise<string | null> {
  const task = await db.tasks.get(taskId);
  if (!task) return null;

  const tomorrow = addDaysToDate(task.target_date, 1);
  const updates: Partial<Task> = {
    target_date: tomorrow,
    updated_at: new Date().toISOString()
  };

  // If there was a reminder, shift it as well
  if (task.reminder_time) {
    try {
      const timeParts = task.reminder_time.split('T');
      if (timeParts.length > 1) {
        updates.reminder_time = `${tomorrow}T${timeParts[1]}`;
      }
    } catch { /* keep existing */ }
  }

  await db.tasks.update(taskId, updates);
  return tomorrow;
}

/**
 * Hard Delete Action (from IndexedDB)
 */
export async function deleteTask(taskId: string): Promise<boolean> {
  const task = await db.tasks.get(taskId);
  if (!task) return false;

  await db.tasks.delete(taskId);
  
  // If no other task uses this recurring template, we can clean up the template
  if (task.recurring_template_id) {
    const tasksWithTemplate = await db.tasks
      .where('recurring_template_id')
      .equals(task.recurring_template_id)
      .count();

    if (tasksWithTemplate === 0) {
      await db.recurring_templates.delete(task.recurring_template_id);
    }
  }
  return true;
}

/**
 * Automatic Midnight Rollover:
 * On app initialization, any task with a status of 'pending' or 'on_hold'
 * whose target_date is in the past must automatically have its target_date updated to today.
 */
export async function runMidnightRollover(): Promise<number> {
  const today = getLocalTodayDate();
  const pastTasks = await db.tasks
    .where('target_date')
    .below(today)
    .toArray();

  const activeRollover = pastTasks.filter(
    t => t.status === 'pending' || t.status === 'on_hold'
  );

  const nowString = new Date().toISOString();
  let countUpdated = 0;

  for (const t of activeRollover) {
    const updates: Partial<Task> = {
      target_date: today,
      updated_at: nowString
    };

    if (t.reminder_time) {
      try {
        const timeParts = t.reminder_time.split('T');
        if (timeParts.length > 1) {
          updates.reminder_time = `${today}T${timeParts[1]}`;
        }
      } catch { /* skip */ }
    }

    await db.tasks.update(t.id, updates);
    countUpdated++;
  }

  return countUpdated;
}

/**
 * Changes a basic status to another
 */
export async function updateTaskStatus(taskId: string, status: TaskStatus): Promise<boolean> {
  const task = await db.tasks.get(taskId);
  if (!task) return false;

  if (status === 'completed') {
    await completeTask(taskId);
  } else {
    await db.tasks.update(taskId, {
      status,
      updated_at: new Date().toISOString()
    });
  }
  return true;
}

// -------------------------------------------------------------
// Daily Routines Operations & Utilities
// -------------------------------------------------------------

/**
 * Returns a list of date strings (YYYY-MM-DD) between two dates, inclusive.
 */
export function getDatesBetween(startDateStr: string, endDateStr: string): string[] {
  const dates: string[] = [];
  let current = startDateStr;
  let iterations = 0;
  while (current <= endDateStr && iterations < 366) {
    dates.push(current);
    current = addDaysToDate(current, 1);
    iterations++;
  }
  return dates;
}

/**
 * Creates a new routine definition and registers today's instance.
 */
export async function createRoutine(title: string): Promise<Routine> {
  const now = new Date().toISOString();
  const id = getSafeUUID();
  const today = getLocalTodayDate();

  const newRoutine: Routine = {
    id,
    title: title.trim(),
    created_at: now,
    start_date: today,
    is_active: true
  };

  await db.routines.add(newRoutine);

  // Instantly seed a pending instance for today
  const instanceId = `${id}_${today}`;
  const instance: RoutineInstance = {
    id: instanceId,
    routine_id: id,
    date: today,
    status: 'pending',
    updated_at: now
  };
  await db.routine_instances.add(instance);

  return newRoutine;
}

/**
 * Sets status of a routine instance for a given date.
 */
export async function toggleRoutineInstance(
  routineId: string,
  date: string,
  status: 'completed' | 'skipped' | 'pending'
): Promise<RoutineInstance> {
  const instanceId = `${routineId}_${date}`;
  const existing = await db.routine_instances.get(instanceId);
  const now = new Date().toISOString();

  if (existing) {
    await db.routine_instances.update(instanceId, {
      status,
      updated_at: now
    });
    return { ...existing, status, updated_at: now };
  } else {
    const newInstance: RoutineInstance = {
      id: instanceId,
      routine_id: routineId,
      date,
      status,
      updated_at: now
    };
    await db.routine_instances.add(newInstance);
    return newInstance;
  }
}

/**
 * Completely removes a routine definition and all its historic logs.
 */
export async function deleteRoutine(routineId: string): Promise<void> {
  await db.routines.delete(routineId);
  // Delete all historical logs
  const instances = await db.routine_instances.where('routine_id').equals(routineId).toArray();
  for (const inst of instances) {
    await db.routine_instances.delete(inst.id);
  }
}

/**
 * Automatically synchronizes routine status logs for any date gaps:
 * 1. Backfills any missing active routine instances from start_date to today.
 *    - Today's missing instance is initialized as 'pending'.
 *    - Past missing instances are initialized as 'skipped' (since the day has finished).
 * 2. Transition past 'pending' instances to 'skipped' (day finish expiration).
 */
export async function syncRoutinesForDateRange(): Promise<void> {
  const today = getLocalTodayDate();
  const allRoutines = await db.routines.toArray();
  const activeRoutines = allRoutines.filter(r => r.is_active);
  const now = new Date().toISOString();

  for (const routine of activeRoutines) {
    const dates = getDatesBetween(routine.start_date, today);
    for (const date of dates) {
      const instanceId = `${routine.id}_${date}`;
      const existing = await db.routine_instances.get(instanceId);

      if (!existing) {
        const defaultStatus = date === today ? 'pending' : 'skipped';
        const newInstance: RoutineInstance = {
          id: instanceId,
          routine_id: routine.id,
          date,
          status: defaultStatus,
          updated_at: now
        };
        await db.routine_instances.add(newInstance);
      } else if (date < today && existing.status === 'pending') {
        await db.routine_instances.update(instanceId, {
          status: 'skipped',
          updated_at: now
        });
      }
    }
  }
}

