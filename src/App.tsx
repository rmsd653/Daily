import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  Circle, 
  ChevronRight, 
  Calendar, 
  Clock, 
  Trash2, 
  Plus, 
  Sliders, 
  X, 
  Bell, 
  BellOff, 
  AlertTriangle, 
  Clock3, 
  CornerDownRight, 
  Archive, 
  Info,
  Sparkles,
  Wifi,
  WifiOff,
  Activity,
  CalendarCheck,
  Check,
  Sun,
  Moon
} from 'lucide-react';
import { 
  db, 
  createTask, 
  completeTask, 
  deferTask, 
  deleteTask, 
  runMidnightRollover, 
  updateTaskStatus,
  getLocalTodayDate,
  addDaysToDate,
  requestNotificationPermission,
  fireSystemNotification
} from './db';
import { Task, TaskStatus, RecurrenceFrequency } from './types';


export default function App() {
  // PWA & Environment State
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [hasNotificationPermission, setHasNotificationPermission] = useState<boolean>(
    'Notification' in window && Notification.permission === 'granted'
  );

  // Theme Toggle State
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme;
    }
    return 'dark'; // Maintain dark default
  });

  // Synchronize HTML element classes when theme shifts
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);
  
  // Tasks Store state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rolloverCount, setRolloverCount] = useState<number>(0);
  const [showRolloverToast, setShowRolloverToast] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming' | 'completed' | 'cancelled'>('today');

  // Form State
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [title, setTitle] = useState<string>('');
  const [remark, setRemark] = useState<string>('');
  const [targetDate, setTargetDate] = useState<string>(getLocalTodayDate());
  const [reminderTime, setReminderTime] = useState<string>('');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('none');
  const [customGapDays, setCustomGapDays] = useState<number>(2);
  const [formStatus, setFormStatus] = useState<TaskStatus>('pending');
  const [formError, setFormError] = useState<string>('');

  // UI Feedback State (Toasts/Modals)
  const [toastMessage, setToastMessage] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Search & Filter Term
  const [searchTerm, setSearchTerm] = useState<string>('');

  // 1. Monitor network connection to update online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 2. Database hydration & midnight rollover on launch
  useEffect(() => {
    async function initializeApp() {
      // Execute the auto rollover for past pending/on_hold tasks
      try {
        const rolledCount = await runMidnightRollover();
        if (rolledCount > 0) {
          setRolloverCount(rolledCount);
          setShowRolloverToast(true);
          // Autohide rollover banner after 6 seconds
          setTimeout(() => setShowRolloverToast(false), 6000);
        }
      } catch (err) {
        console.error('Error conducting rollover engine:', err);
      }
      
      await reloadTasks();
    }
    initializeApp();
  }, [activeTab]);

  // 3. Periodic Background Alarm Polling Daemon (Runs local reminder checker)
  useEffect(() => {
    const alarmInterval = setInterval(() => {
      checkActiveAlarms();
    }, 5000); // Polls every 5 seconds for absolute precision
    return () => clearInterval(alarmInterval);
  }, [tasks]);

  const checkActiveAlarms = () => {
    const now = new Date();
    // Get fired reminders list from localStorage to avoid spamming alerts
    let firedList: string[] = [];
    try {
      firedList = JSON.parse(localStorage.getItem('fired_task_reminders') || '[]');
    } catch {
      firedList = [];
    }

    const uncompletedTasksWithReminders = tasks.filter(
      t => t.status !== 'completed' && t.status !== 'cancelled' && t.reminder_time
    );

    uncompletedTasksWithReminders.forEach(t => {
      if (!t.reminder_time) return;
      
      const alarmTime = new Date(t.reminder_time);
      // If task scheduled reminder has reached or passed, and hasn't been fired yet
      if (now >= alarmTime && !firedList.includes(t.id)) {
        fireSystemNotification(t.id, t.title, t.remark);
        
        // Push to fired list and save
        firedList.push(t.id);
        localStorage.setItem('fired_task_reminders', JSON.stringify(firedList));
        
        // Push a visual app toast
        triggerToast(`⏰ Alert: "${t.title}" is scheduled now!`);
      }
    });
  };

  const reloadTasks = async () => {
    try {
      const allTasks = await db.tasks.toArray();
      // Sort tasks primarily by created_at or target_dates
      allTasks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setTasks(allTasks);
    } catch (err) {
      console.error('Failed to load tasks from local store:', err);
    }
  };

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 4000);
  };

  // Permission click handler
  const handleEnableNotifications = async () => {
    const allowed = await requestNotificationPermission();
    setHasNotificationPermission(allowed);
    if (allowed) {
      triggerToast('🔔 System Notifications successfully authorized!');
    } else {
      triggerToast('❌ Notification prompt was denied or unsupported.');
    }
  };

  // Submit new task wrapper
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setFormError('Please describe a task title.');
      return;
    }

    try {
      await createTask(
        title.trim(),
        targetDate,
        remark,
        reminderTime || undefined,
        formStatus,
        frequency,
        frequency === 'custom_gap' ? customGapDays : undefined
      );

      triggerToast('✨ Task successfully registered offline!');
      
      // Reset form variables
      setTitle('');
      setRemark('');
      setTargetDate(getLocalTodayDate());
      setReminderTime('');
      setFrequency('none');
      setCustomGapDays(2);
      setFormStatus('pending');
      setFormError('');
      setIsFormOpen(false);
      
      await reloadTasks();
    } catch (err) {
      console.error(err);
      setFormError('Could not store item in local database.');
    }
  };

  // Task execution shortcuts
  const handleCheckTask = async (taskId: string) => {
    try {
      const nextDate = await completeTask(taskId);
      if (nextDate) {
        triggerToast(`🎉 Task completed! Recurring schedule auto-created for tomorrow or custom gap: ${nextDate}`);
      } else {
        triggerToast('✓ Task completed!');
      }
      await reloadTasks();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDefer = async (taskId: string) => {
    try {
      const deferredDate = await deferTask(taskId);
      triggerToast(`📅 Deferred: Shifted to ${deferredDate}`);
      await reloadTasks();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteConfirm = async (taskId: string) => {
    setConfirmDeleteId(taskId);
  };

  const executeDelete = async () => {
    if (!confirmDeleteId) return;
    try {
      await deleteTask(confirmDeleteId);
      triggerToast('🗑 Task permanently purged from device repository.');
      setConfirmDeleteId(null);
      await reloadTasks();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateStatusDirectly = async (taskId: string, targetStatus: TaskStatus) => {
    try {
      await updateTaskStatus(taskId, targetStatus);
      const label = targetStatus.charAt(0).toUpperCase() + targetStatus.slice(1);
      triggerToast(`Task status adjusted to ${label}`);
      await reloadTasks();
    } catch (err) {
      console.error(err);
    }
  };

  // presets helper for quick date choices
  const setQuickDate = (mode: 'today' | 'tomorrow' | 'nextWeek') => {
    const today = getLocalTodayDate();
    if (mode === 'today') {
      setTargetDate(today);
    } else if (mode === 'tomorrow') {
      setTargetDate(addDaysToDate(today, 1));
    } else if (mode === 'nextWeek') {
      setTargetDate(addDaysToDate(today, 7));
    }
  };

  // -------------------------------------------------------------
  // Filter and Category segmentation logic
  // -------------------------------------------------------------
  const todayDateString = getLocalTodayDate();

  const filteredTasks = tasks.filter(t => {
    // 1. Apply Search query
    const matchSearch = 
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (t.remark && t.remark.toLowerCase().includes(searchTerm.toLowerCase()));
    
    if (!matchSearch) return false;

    // 2. Segment by Board Navigation tabs
    if (activeTab === 'today') {
      // TODAY'S DASHBOARD: displays tasks where target_date equals the current local date AND status is 'pending' or 'on_hold'.
      return t.target_date === todayDateString && (t.status === 'pending' || t.status === 'on_hold');
    }
    
    if (activeTab === 'upcoming') {
      // FUTURE TASKS VIEW: shows all future 'pending' or 'on_hold' tasks grouped chronologically.
      return t.target_date > todayDateString && (t.status === 'pending' || t.status === 'on_hold');
    }

    if (activeTab === 'completed') {
      // COMPLETED SUMMARY VIEW: archive of all tasks with status = 'completed', sorted by completion history.
      return t.status === 'completed';
    }

    if (activeTab === 'cancelled') {
      // CANCELLED/ARCHIVED VIEW: secondary filter or list to review 'cancelled' tasks.
      return t.status === 'cancelled';
    }

    return true;
  });

  // Group future tasks chronologically if activeTab is 'upcoming'
  const upcomingGrouped: { [date: string]: Task[] } = {};
  if (activeTab === 'upcoming') {
    filteredTasks.forEach(task => {
      if (!upcomingGrouped[task.target_date]) {
        upcomingGrouped[task.target_date] = [];
      }
      upcomingGrouped[task.target_date].push(task);
    });
  }

  // Sort dates key for upcoming chronologically
  const sortedUpcomingDates = Object.keys(upcomingGrouped).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );

  return (
    <div className="min-h-screen bg-app-bg text-app-text flex flex-col font-sans selection:bg-teal-500/30 selection:text-teal-200 transition-colors duration-250">
      
      {/* 1. Header Area with Offline + Notifications Telemetry */}
      <header className="border-b border-app-hdr-bdr bg-app-hdr-bg backdrop-blur-md sticky top-0 z-40 px-4 py-4.5 sm:px-6 transition-colors duration-250">
        <div className="max-w-4xl mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          
          {/* Logo / branding */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-teal-500/10 to-teal-500/20 rounded-xl border border-teal-500/20 shadow-lg shadow-teal-500/5">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" className="w-6 h-6">
                <rect x="96" y="96" width="320" height="320" rx="32" fill="var(--app-card)" opacity="0.4"/>
                <rect x="160" y="64" width="48" height="96" rx="24" fill="#14b8a6"/>
                <rect x="304" y="64" width="48" height="96" rx="24" fill="#14b8a6"/>
                <path d="M150 280 l70 70 140 -140" fill="none" stroke="#14b8a6" strokeWidth="48" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h1 className="font-display font-bold text-xl tracking-tight text-app-bold flex items-center gap-2">
                TaskPWA <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 font-medium">Offline Core</span>
              </h1>
              <p className="text-xs text-app-muted font-mono">Modern Progressive Web App</p>
            </div>
          </div>

          {/* Telemetry and Controls */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Connection badge */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border ${
              isOnline 
                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
                : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
            }`}>
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                  <span>Device: Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-500" />
                  <span>Device: Offline-Optimized</span>
                </>
              )}
            </div>

            {/* Notification triggers request */}
            <button
              id="btn-alert-setup"
              onClick={handleEnableNotifications}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                hasNotificationPermission 
                  ? 'bg-app-card border-app-border text-app-muted hover:text-app-bold' 
                  : 'bg-teal-900/10 hover:bg-teal-900/20 text-teal-400 border-teal-500/20'
              }`}
            >
              {hasNotificationPermission ? (
                <>
                  <Bell className="w-3.5 h-3.5 text-teal-400" />
                  <span>Alerts Enabled</span>
                </>
              ) : (
                <>
                  <BellOff className="w-3.5 h-3.5 text-app-muted" />
                  <span>Activate System Alerts</span>
                </>
              )}
            </button>

            {/* Theme Toggle option */}
            <button
              id="btn-theme-toggle"
              type="button"
              onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
              className="flex items-center justify-center p-2 rounded-lg border border-app-border bg-app-card hover:bg-app-panel text-app-muted hover:text-app-bold transition-all cursor-pointer"
              title={theme === 'light' ? "Switch to dark theme" : "Switch to light theme"}
            >
              {theme === 'light' ? (
                <Moon className="w-3.5 h-3.5 text-slate-500" />
              ) : (
                <Sun className="w-3.5 h-3.5 text-amber-400" />
              )}
            </button>

            {/* Add task hero trigger button */}
            <button
              id="btn-add-task-header"
              onClick={() => setIsFormOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-slate-950 font-semibold text-xs rounded-lg transition-all shadow-md shadow-teal-950/20 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-slate-950" />
              <span>Create Task</span>
            </button>

          </div>
        </div>
      </header>

      {/* 2. Top-Level Messages / Midnight Rollover Alert */}
      {showRolloverToast && (
        <div className="bg-gradient-to-r from-amber-950/40 via-amber-900/20 to-slate-950 border-y border-amber-500/20 px-4 py-3 text-center transition-all animate-fadeIn">
          <div className="max-w-4xl mx-auto flex items-center justify-center gap-2.5 text-amber-200 text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 animate-bounce" />
            <span>
              <strong>Midnight Rollover Engine Triggered:</strong> {rolloverCount} overdue task{rolloverCount > 1 ? 's' : ''} with status pending/on-hold moved to today!
            </span>
            <button 
              onClick={() => setShowRolloverToast(false)} 
              className="ml-auto text-amber-400/60 hover:text-amber-200 transition-colors p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main app grid */}
      <main className="max-w-4xl w-full mx-auto p-4 sm:p-6 flex-grow flex flex-col gap-6">

        {/* 3. Task Creation Panel (Controlled collapsible slider/dialog) */}
        {isFormOpen && (
          <div className="bg-app-card border border-app-border rounded-2xl p-5 sm:p-6 shadow-2xl relative animate-fadeIn">
            
            {/* Top Close */}
            <button 
              onClick={() => setIsFormOpen(false)}
              className="absolute top-4 right-4 text-app-muted hover:text-app-bold p-1.5 bg-app-input rounded-lg hover:bg-app-panel transition-all border border-app-border cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <h2 className="font-display font-bold text-lg text-app-bold mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-teal-400" />
              Compose Local Task
            </h2>

            <form onSubmit={handleCreateTask} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Left Group */}
              <div className="space-y-4">
                
                {/* Title */}
                <div>
                  <label className="block text-xs font-mono text-app-muted font-semibold mb-1">Task Title *</label>
                  <input
                    id="input-title"
                    type="text"
                    required
                    placeholder="e.g. Complete quarterly reporting, Gym workout..."
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-app-input border border-app-input-bdr rounded-xl px-3.5 py-2.5 text-app-text text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 placeholder-app-muted/50 transition-colors"
                  />
                </div>

                {/* Remark / Notes */}
                <div>
                  <label className="block text-xs font-mono text-app-muted font-semibold mb-1">Remark / Notes (Optional)</label>
                  <textarea
                    id="input-remark"
                    placeholder="Enter additional details or references here..."
                    rows={3}
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    className="w-full bg-app-input border border-app-input-bdr rounded-xl px-3.5 py-2 text-app-text text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 placeholder-app-muted/50 transition-colors resize-none"
                  />
                </div>

                {/* Status Picker (Creation Default) */}
                <div>
                  <label className="block text-xs font-mono text-app-muted font-semibold mb-1">Initial Status</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormStatus('pending')}
                      className={`px-3 py-2 text-xs font-mono rounded-lg border text-center transition-all cursor-pointer ${
                        formStatus === 'pending'
                          ? 'bg-teal-500/15 text-teal-400 border-teal-500/30 font-medium'
                          : 'bg-app-input text-app-muted border-app-input-bdr hover:text-app-bold hover:bg-app-panel'
                      }`}
                    >
                      Pending
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormStatus('on_hold')}
                      className={`px-3 py-2 text-xs font-mono rounded-lg border text-center transition-all cursor-pointer ${
                        formStatus === 'on_hold'
                          ? 'bg-amber-500/15 text-amber-500 border-amber-500/30 font-medium'
                          : 'bg-app-input text-app-muted border-app-input-bdr hover:text-app-bold hover:bg-app-panel'
                      }`}
                    >
                      On Hold
                    </button>
                  </div>
                </div>

              </div>

              {/* Right Group */}
              <div className="space-y-4">
                
                {/* Target Date */}
                <div>
                  <label className="block text-xs font-mono text-app-muted font-semibold mb-1">Target Date</label>
                  <input
                    id="input-target-date"
                    type="date"
                    required
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="w-full bg-app-input border border-app-input-bdr rounded-xl px-3.5 py-2.5 text-app-text text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 transition-colors cursor-pointer"
                  />
                  
                  {/* Quick-select presets */}
                  <div className="flex gap-1.5 mt-1.5">
                    <button
                      type="button"
                      onClick={() => setQuickDate('today')}
                      className="text-[10px] font-mono px-2 py-0.5 bg-app-input hover:bg-app-panel text-app-text border border-app-input-bdr rounded transition-colors cursor-pointer"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickDate('tomorrow')}
                      className="text-[10px] font-mono px-2 py-0.5 bg-app-input hover:bg-app-panel text-app-text border border-app-input-bdr rounded transition-colors cursor-pointer"
                    >
                      Tomorrow
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickDate('nextWeek')}
                      className="text-[10px] font-mono px-2 py-0.5 bg-app-input hover:bg-app-panel text-app-text border border-app-input-bdr rounded transition-colors cursor-pointer"
                    >
                      +1 Week
                    </button>
                  </div>
                </div>

                {/* Optional Reminder Alert Time */}
                <div>
                  <label className="block text-xs font-mono text-app-muted font-semibold mb-1 flex items-center gap-1">
                    <Clock3 className="w-3.5 h-3.5 text-teal-400" />
                    <span>Reminder Alarm (Optional)</span>
                  </label>
                  <input
                    id="input-reminder-time"
                    type="time"
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                    className="w-full bg-app-input border border-app-input-bdr rounded-xl px-3.5 py-2.5 text-app-text text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 transition-colors cursor-pointer"
                  />
                  <p className="text-[10px] text-app-muted font-mono mt-1">Triggers audio alert + notification even offline.</p>
                </div>

                {/* Recurrence Settings Dropdown */}
                <div className="bg-app-input p-3 rounded-xl border border-app-input-bdr">
                  <label className="block text-xs font-mono text-app-muted font-semibold mb-1.5 flex items-center gap-1">
                    <Sliders className="w-3.5 h-3.5 text-teal-400" />
                    <span>Recurrence / Repetition</span>
                  </label>
                  <select
                    id="select-frequency"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
                    className="w-full bg-app-card border border-app-border rounded-lg px-2.5 py-1.5 text-app-text text-xs focus:outline-none focus:ring-1 focus:ring-teal-500 cursor-pointer"
                  >
                    <option value="none">One-time (None)</option>
                    <option value="daily">Daily Loop (Day + 1)</option>
                    <option value="weekly">Weekly Loop (Day + 7)</option>
                    <option value="monthly">Monthly Loop (Month + 1)</option>
                    <option value="custom_gap">Custom Skip Gap (N Skip Days)</option>
                  </select>

                  {/* Custom gap input conditional */}
                  {frequency === 'custom_gap' && (
                    <div className="mt-3 bg-app-card p-2.5 rounded-lg border border-app-border animate-slideDown">
                      <label className="block text-[10px] font-mono text-app-muted mb-1">
                        Days to Skip (N skipped days before next, Day + N + 1)
                      </label>
                      <input
                        id="input-custom-gap"
                        type="number"
                        min={1}
                        max={365}
                        value={customGapDays}
                        onChange={(e) => setCustomGapDays(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full bg-app-input border border-app-input-bdr rounded px-2.5 py-1.5 text-app-text text-xs focus:outline-none"
                      />
                      <p className="text-[9px] text-app-muted font-mono mt-1">
                        e.g., If N is 2, Day 1 completes, Day 2 & 3 skipped, scheduled for Day 4.
                      </p>
                    </div>
                  )}
                </div>

              </div>

              {/* Form Validation Indicator and Action Footer */}
              <div className="md:col-span-2 mt-2 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between border-t border-app-border pt-4">
                <div className="text-xs text-rose-400 font-mono">
                  {formError && <span>💡 {formError}</span>}
                </div>
                
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="px-4 py-2 text-xs font-mono text-app-muted hover:text-app-bold rounded-lg hover:bg-app-panel transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    id="btn-submit-task"
                    type="submit"
                    className="px-5 py-2 bg-teal-500 hover:bg-teal-400 active:bg-teal-600 text-slate-950 font-semibold text-xs rounded-xl transition-all shadow-md cursor-pointer animate-pulse-slow"
                  >
                    Add to Local Database
                  </button>
                </div>
              </div>

            </form>
          </div>
        )}

        {/* 4. Filter Bars & Segmented Navigation */}
        <section className="bg-app-panel border border-app-panel-bdr rounded-2xl p-4 flex flex-col gap-4">
          
          {/* Main Visual Search */}
          <div className="relative">
            <input
              id="input-search"
              type="text"
              placeholder="Query tasks/remarks stored on this hardware..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-app-input border border-app-input-bdr rounded-xl pl-4 pr-10 py-2.5 text-app-text text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 placeholder-app-muted/50 transition-colors"
            />
            {searchTerm ? (
              <button 
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-app-muted hover:text-app-bold p-1 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-app-muted/60 text-xs font-mono pointer-events-none">
                SEARCH
              </span>
            )}
          </div>

          {/* Tab Selection Row */}
          <div className="flex border-b border-app-border pb-1 overflow-x-auto scrollbar-none gap-1">
            
            {/* TAB: TODAY'S DASHBOARD */}
            <button
              id="tab-today"
              onClick={() => setActiveTab('today')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-medium rounded-t-lg border-b-2 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'today'
                  ? 'border-teal-500 text-teal-500 bg-teal-500/5'
                  : 'border-transparent text-app-muted hover:text-app-bold hover:bg-app-panel/50'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Today's Active</span>
              <span className="ml-1 text-[10px] px-1.5 py-0.5 bg-app-input border border-app-input-bdr rounded-full text-app-muted font-semibold">
                {tasks.filter(t => t.target_date === todayDateString && (t.status === 'pending' || t.status === 'on_hold')).length}
              </span>
            </button>

            {/* TAB: UPCOMING */}
            <button
              id="tab-upcoming"
              onClick={() => setActiveTab('upcoming')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-medium rounded-t-lg border-b-2 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'upcoming'
                  ? 'border-teal-500 text-teal-500 bg-teal-500/5'
                  : 'border-transparent text-app-muted hover:text-app-bold hover:bg-app-panel/50'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Future Board</span>
              <span className="ml-1 text-[10px] px-1.5 py-0.5 bg-app-input border border-app-input-bdr rounded-full text-app-muted font-semibold">
                {tasks.filter(t => t.target_date > todayDateString && (t.status === 'pending' || t.status === 'on_hold')).length}
              </span>
            </button>

            {/* TAB: COMPLETED ARCHIVE */}
            <button
              id="tab-completed"
              onClick={() => setActiveTab('completed')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-medium rounded-t-lg border-b-2 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'completed'
                  ? 'border-teal-500 text-teal-500 bg-teal-500/5'
                  : 'border-transparent text-app-muted hover:text-app-bold hover:bg-app-panel/50'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Completed Archive</span>
              <span className="ml-1 text-[10px] px-1.5 py-0.5 bg-app-input border border-app-input-bdr rounded-full text-app-muted font-semibold">
                {tasks.filter(t => t.status === 'completed').length}
              </span>
            </button>

            {/* TAB: CANCELLED */}
            <button
              id="tab-cancelled"
              onClick={() => setActiveTab('cancelled')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-medium rounded-t-lg border-b-2 transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'cancelled'
                  ? 'border-teal-500 text-teal-500 bg-teal-500/5'
                  : 'border-transparent text-app-muted hover:text-app-bold hover:bg-app-panel/50'
              }`}
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Cancelled List</span>
              <span className="ml-1 text-[10px] px-1.5 py-0.5 bg-app-input border border-app-input-bdr rounded-full text-app-muted font-semibold">
                {tasks.filter(t => t.status === 'cancelled').length}
              </span>
            </button>

          </div>
        </section>

        {/* 5. Confirmation Purge Modal popup overlay */}
        {confirmDeleteId && (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-app-card border border-rose-500/30 max-w-sm w-full rounded-2xl p-6 shadow-2xl animate-scaleIn">
              <div className="flex items-center gap-3 text-red-500 mb-3">
                <AlertTriangle className="w-6 h-6 flex-shrink-0" />
                <h3 className="font-display font-bold text-lg text-app-bold">Permanent Purge</h3>
              </div>
              <p className="text-app-muted text-xs font-sans leading-relaxed mb-6">
                Are you absolutely sure you want to completely destroy this task from your local machine database? This action is permanent and cannot be synchronized or recovered.
              </p>
              <div className="flex justify-end gap-3.5">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-4 py-2 bg-app-input hover:bg-app-panel text-app-text font-mono text-xs rounded-xl border border-app-border transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-delete"
                  type="button"
                  onClick={executeDelete}
                  className="px-5 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-semibold text-xs rounded-xl transition-all shadow-lg cursor-pointer"
                >
                  Purge Permanently
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 6. Active Render Block of Cards */}
        <section className="flex-grow flex flex-col gap-4">
          
          {/* Active Tab Header details */}
          <div className="flex items-center justify-between pb-1 border-b border-app-border">
            <h3 className="font-mono text-xs text-app-muted tracking-wider uppercase">
              {activeTab === 'today' && "Displaying Today's Active Tasks"}
              {activeTab === 'upcoming' && "Chronological Upcoming Planner"}
              {activeTab === 'completed' && "Session History Log"}
              {activeTab === 'cancelled' && "Discarded Activity Log"}
            </h3>
            
            {/* Filter outputs info */}
            <span className="text-[10px] text-app-muted font-mono">
              Found {filteredTasks.length} items
            </span>
          </div>

          {/* Empty Placeholders */}
          {filteredTasks.length === 0 && (
            <div className="bg-app-panel/30 border border-dashed border-app-border rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-4">
              <div className="p-4 bg-app-input rounded-full border border-app-border">
                <CalendarCheck className="w-8 h-8 text-app-muted" />
              </div>
              <div>
                <h4 className="font-display font-medium text-app-bold">No matching records</h4>
                <p className="text-xs text-app-muted max-w-xs mt-1 font-sans">
                  All local nodes are clear. Either your search is too strict, or you are completely caught up! Choose 'Create Task' inside our telemetry rail to compose a task.
                </p>
              </div>
              {activeTab === 'today' && (
                <button
                  onClick={() => setIsFormOpen(true)}
                  className="mt-2 text-xs font-mono font-medium text-teal-500 bg-teal-500/10 hover:bg-teal-500/20 px-3 py-1.5 rounded-lg border border-teal-500/25 transition-all cursor-pointer"
                >
                  + Add task scheduled for today
                </button>
              )}
            </div>
          )}

          {/* TODAY'S / COMPLETED / CANCELLED RENDER CARD LIST */}
          {activeTab !== 'upcoming' && filteredTasks.length > 0 && (
            <div className="grid grid-cols-1 gap-3">
              {filteredTasks.map(task => (
                <TaskCard 
                  key={task.id} 
                  task={task} 
                  onCheck={handleCheckTask}
                  onDefer={handleDefer}
                  onDelete={handleDeleteConfirm}
                  onStatusChange={handleUpdateStatusDirectly}
                />
              ))}
            </div>
          )}

          {/* CHRONOLOGICAL UPCOMING VIEW (Grouped by target dates) */}
          {activeTab === 'upcoming' && filteredTasks.length > 0 && (
            <div className="space-y-6">
              {sortedUpcomingDates.map(dateKey => {
                const dayTasks = upcomingGrouped[dateKey];
                
                // Construct beautiful human date representer
                const [y, m, d] = dateKey.split('-').map(Number);
                const jsDate = new Date(y, m - 1, d);
                const formatOpts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric' };
                const dateLabel = jsDate.toLocaleDateString('en-US', formatOpts);

                return (
                  <div key={dateKey} className="space-y-2">
                    <div className="flex items-center gap-2 sticky top-[100px] bg-app-bg/90 py-1.5 z-10 backdrop-blur-xs">
                      <span className="text-xs font-mono font-bold bg-app-card border border-app-border text-teal-500 px-2.5 py-1 rounded-md">
                        {dateKey}
                      </span>
                      <span className="text-xs font-sans text-app-muted font-medium">• {dateLabel}</span>
                    </div>

                    <div className="grid grid-cols-1 gap-3 pl-3 border-l-2 border-app-border">
                      {dayTasks.map(task => (
                        <TaskCard 
                          key={task.id} 
                          task={task} 
                          onCheck={handleCheckTask}
                          onDefer={handleDefer}
                          onDelete={handleDeleteConfirm}
                          onStatusChange={handleUpdateStatusDirectly}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </section>

      </main>

      {/* 7. Persistent system status action notifications chimes */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-app-card border border-teal-500/20 px-4.5 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 max-w-sm animate-slideUp text-xs font-mono text-app-text">
          <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse flex-shrink-0" />
          <span>{toastMessage}</span>
          <button 
            onClick={() => setToastMessage('')} 
            className="text-app-muted hover:text-app-bold ml-auto cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Footer system details */}
      <footer className="border-t border-app-border p-6 bg-app-hdr-bg text-app-muted text-center text-xs font-mono transition-colors duration-250">
        <div className="max-w-4xl mx-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Progressive Local Task Core. Zero external assets synced.</p>
          <div className="flex gap-4 justify-center">
            <span>IndexedDB Synced</span>
            <span>•</span>
            <span>W3C Notification trigger compatible</span>
          </div>
        </div>
      </footer>

    </div>
  );
}


// -------------------------------------------------------------
// CHILD COMPONENT: TASK CARD (Isolated modular rendering)
// -------------------------------------------------------------
interface TaskCardProps {
  key?: string;
  task: Task;
  onCheck: (id: string) => void;
  onDefer: (id: string) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
}

function TaskCard({ task, onCheck, onDefer, onDelete, onStatusChange }: TaskCardProps) {
  const isCompleted = task.status === 'completed';
  const isCancelled = task.status === 'cancelled';
  const isOnHold = task.status === 'on_hold';

  // Extract recurrence text if template present
  const [recurrenceDesc, setRecurrenceDesc] = useState<string>('');

  useEffect(() => {
    async function loadTemplate() {
      if (task.recurring_template_id) {
        try {
          const t = await db.recurring_templates.get(task.recurring_template_id);
          if (t) {
            let label = '';
            if (t.frequency === 'daily') label = 'Looping Daily';
            else if (t.frequency === 'weekly') label = 'Looping Weekly ';
            else if (t.frequency === 'monthly') label = 'Looping Monthly';
            else if (t.frequency === 'custom_gap') label = `Looping (Skip ${t.custom_gap_days} d)`;
            setRecurrenceDesc(label);
          }
        } catch { /* skip */ }
      }
    }
    loadTemplate();
  }, [task]);

  // Extract human alarm time to print nicely
  const getDisplayAlarm = () => {
    if (!task.reminder_time) return null;
    try {
      const parts = task.reminder_time.split('T');
      if (parts.length > 1) {
        return parts[1]; // Return "HH:mm" section
      }
    } catch { /* skip */ }
    return null;
  };

  const alarmDisplay = getDisplayAlarm();

  return (
    <div className={`group border transition-all rounded-xl p-4 flex flex-col md:flex-row md:items-start justify-between gap-4 ${
      isCompleted 
        ? 'border-transparent opacity-60 bg-app-panel/40' 
        : isCancelled
          ? 'border-transparent opacity-50 bg-app-panel/30'
          : isOnHold
            ? 'border-amber-500/20 hover:border-amber-500/40 bg-app-card shadow-sm'
            : 'border-app-border bg-app-card shadow-xs hover:shadow-md'
    }`}>
      
      {/* Complete trigger / details column */}
      <div className="flex items-start gap-3.5 flex-grow">
        
        {/* Absolute Fast action checkbox */}
        <button
          onClick={() => {
            if (isCompleted) {
              onStatusChange(task.id, 'pending');
            } else {
              onCheck(task.id);
            }
          }}
          className="mt-1.5 focus:outline-none flex-shrink-0 cursor-pointer"
          title={isCompleted ? "Revert to pending" : "Mark as completed"}
        >
          {isCompleted ? (
            <CheckCircle2 className="w-5.5 h-5.5 text-teal-500 stroke-[2.5]" />
          ) : (
            <Circle className="w-5.5 h-5.5 text-app-muted hover:text-teal-500 stroke-[1.8] transition-colors" />
          )}
        </button>

        {/* Text Area */}
        <div className="space-y-1.5 flex-grow">
          <div>
            <h4 className={`font-sans font-semibold text-sm leading-snug break-words transition-colors duration-150 ${
              isCompleted ? 'text-app-muted line-through opacity-80' : 'text-app-bold'
            }`}>
              {task.title}
            </h4>
            {task.remark && (
              <p className={`text-xs mt-1 leading-relaxed break-words max-w-xl transition-colors duration-150 ${
                isCompleted ? 'text-app-muted/50' : 'text-app-muted'
              }`}>
                {task.remark}
              </p>
            )}
          </div>

          {/* Quick inline badges row */}
          <div className="flex flex-wrap items-center gap-1.5">
            
            {/* Status Indicator Pill */}
            {!isCompleted && !isCancelled && (
              <select
                value={task.status}
                onChange={(e) => onStatusChange(task.id, e.target.value as TaskStatus)}
                className={`text-[9px] font-mono px-2 py-0.5 rounded cursor-pointer border focus:outline-none focus:ring-1 focus:ring-teal-500 hover:brightness-110 transition-all ${
                  task.status === 'on_hold'
                    ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                    : 'bg-teal-500/10 text-teal-500 border-teal-500/20'
                }`}
              >
                <option value="pending" className="bg-app-card text-app-text">Pending</option>
                <option value="on_hold" className="bg-app-card text-app-text">On Hold</option>
                <option value="completed" className="bg-app-card text-app-text">Completed</option>
                <option value="cancelled" className="bg-app-card text-app-text">Cancelled</option>
              </select>
            )}

            {isCompleted && (
              <span className="text-[9px] font-mono px-2 py-0.5 bg-app-input text-teal-500 border border-app-border rounded">
                COMPLETED
              </span>
            )}

            {isCancelled && (
              <span className="text-[9px] font-mono px-2 py-0.5 bg-app-input text-app-muted border border-app-border rounded">
                CANCELLED
              </span>
            )}

            {/* Target Date detail */}
            <span className="text-[10px] font-mono text-app-muted bg-app-input px-2 py-0.5 border border-app-border rounded flex items-center gap-1.5">
              <Calendar className="w-3 h-3 text-app-muted" />
              <span>Target: {task.target_date}</span>
            </span>

            {/* Optional loop engine badge */}
            {recurrenceDesc && (
              <span className="text-[10px] font-mono text-teal-500 bg-teal-500/10 px-2 py-0.5 border border-teal-500/20 rounded flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-teal-500 animate-pulse-slow" />
                <span>{recurrenceDesc}</span>
              </span>
            )}

            {/* Optional audio alarm schedule icon */}
            {alarmDisplay && (
              <span className="text-[10px] font-mono text-amber-500 bg-amber-500/10 px-2 py-0.5 border border-amber-500/20 rounded flex items-center gap-1" title="Background notifications trigger enabled">
                <Clock className="w-3 h-3 text-amber-500" />
                <span>Alarm: {alarmDisplay}</span>
              </span>
            )}

          </div>
        </div>

      </div>

      {/* System Action Controls right column */}
      <div className="flex items-center gap-1 sm:gap-2 border-t md:border-t-0 border-app-border pt-2.5 md:pt-0 justify-end md:justify-start">
        
        {/* Deferral action */}
        {!isCompleted && !isCancelled && (
          <button
            onClick={() => onDefer(task.id)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-mono text-app-muted hover:text-teal-500 bg-app-input/50 border border-app-border hover:border-teal-500/25 hover:bg-teal-500/5 transition-all cursor-pointer"
            title="Defer task to next day (+1 day to due date)"
          >
            <ChevronRight className="w-3 h-3" />
            <span>Defer</span>
          </button>
        )}

        {/* Change status toggle directly to cancel if pending */}
        {!isCompleted && !isCancelled && (
          <button
            onClick={() => onStatusChange(task.id, 'cancelled')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-app-muted hover:text-app-bold bg-app-input/50 border border-app-border hover:border-app-border transition-all cursor-pointer"
            title="Cancel and move task to secondary cancel board"
          >
            <span>Cancel</span>
          </button>
        )}

        {/* Restore cancel/completed to pending */}
        {(isCompleted || isCancelled) && (
          <button
            onClick={() => onStatusChange(task.id, 'pending')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-mono text-app-muted hover:text-teal-500 bg-app-input/50 border border-app-border hover:border-teal-500/25 hover:bg-teal-500/5 transition-all cursor-pointer"
            title="Restore node to pending status"
          >
            <span>Restore</span>
          </button>
        )}

        {/* Hard destruction deletion toggle */}
        <button
          onClick={() => onDelete(task.id)}
          className="p-1.5 rounded-lg text-app-muted hover:text-rose-500 bg-app-input/40 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all ml-1 cursor-pointer"
          title="Permanently hard-delete from this device"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

      </div>
    </div>
  );
}
