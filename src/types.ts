export type TaskStatus = 'pending' | 'completed' | 'on_hold' | 'cancelled';

export type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom_gap';

export interface Task {
  id: string; // UUID string
  title: string; // Required
  remark?: string; // Optional notes
  target_date: string; // YYYY-MM-DD local date
  reminder_time?: string; // YYYY-MM-DDTHH:mm format or similar ISO timestamp. If present, indicates a custom alarm.
  status: TaskStatus; // Enum
  created_at: string; // ISO string
  updated_at: string; // ISO string
  is_synced: boolean; // Default false
  recurring_template_id?: string; // Links this task to a repetition profile
}

export interface RecurringTemplate {
  id: string; // UUID string
  title: string; // Template title
  remark?: string; // Copyable remark
  frequency: RecurrenceFrequency; // 'none' | 'daily' | 'weekly' | 'monthly' | 'custom_gap'
  custom_gap_days?: number; // Skip 'n' days if frequency is 'custom_gap'
  last_generated_date?: string; // YYYY-MM-DD of last created instance
  created_at: string;
}

export interface NotificationSchedule {
  id: string;
  taskId: string;
  title: string;
  triggerTime: number; // UTC timestamp of when it should run
  isFired: boolean;
}
