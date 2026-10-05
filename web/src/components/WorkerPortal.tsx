import React, { useState, useEffect, useRef } from 'react';
import {
  Bell,
  CheckCircle2,
  Clock,
  Home,
  MapPin,
  Phone,
  ShieldCheck,
  AlertTriangle,
  Award,
  Navigation,
  Wrench,
  ShoppingBag,
  Plus,
  Compass,
  ArrowRight,
  Info,
  Save,
  Sparkles,
  Trash2,
  Check,
  Tag,
  DollarSign,
  Layers,
  X,
  Settings,
  ImagePlus
} from 'lucide-react';
import type { BookingRecord, WorkerProfile, SparePartProduct, SpareShop, WorkerGig, WorkerPricingModel, CategoryId } from '../types';
import {
  getSavedBookings,
  acknowledgeBooking,
  timeoutAndReassignBooking,
  updateBookingTimeline,
  getSpareProducts,
  getSpareShops,
  addTaskSpareToBooking,
  updateTaskSpareStatus,
  calculateDistanceKm,
  getWorkers,
  updateWorkerProfile,
  addWorkerGig,
  sumCompletedWorkerIncome
} from '../services/repaidoService';
import { buildReminderDeadline, getGeofenceStatus } from '../booking.mjs';
import { seededWorkers, getTechnicianProgress, formatMoney } from '../data';

interface WorkerPortalProps {
  initialWorkerId?: string;
  onBackToCustomerApp?: () => void;
  onLogout?: () => void;
}

export const WorkerPortal: React.FC<WorkerPortalProps> = ({ initialWorkerId, onBackToCustomerApp, onLogout }) => {
  const [workers, setWorkers] = useState<WorkerProfile[]>(() => getWorkers());
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>(
    initialWorkerId || workers.find(w => w.role === 'technician')?.id || workers[0]?.id || 'w-ac-tech-1'
  );

  useEffect(() => {
    if (initialWorkerId) {
      setSelectedWorkerId(initialWorkerId);
    }
  }, [initialWorkerId]);
  const [portalTab, setPortalTab] = useState<'home' | 'tasks' | 'profile'>('home');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [spareProducts, setSpareProducts] = useState<SparePartProduct[]>([]);
  const [spareShops, setSpareShops] = useState<SpareShop[]>([]);
  const [showSpareModal, setShowSpareModal] = useState<boolean>(false);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(false);
  const [simulatedWorkerDistanceToShop, setSimulatedWorkerDistanceToShop] = useState<number>(180); // meters

  // Current active worker
  const currentWorker = workers.find(w => w.id === selectedWorkerId) || workers[0];
  const progress = getTechnicianProgress(currentWorker.points, currentWorker.completedTasks);

  // Pricing & Tools Form State
  const [pricingModel, setPricingModel] = useState<WorkerPricingModel>(currentWorker.pricingModel || 'hourly');
  const [baseFare, setBaseFare] = useState<number>(currentWorker.baseFare || 150);
  const [hourlyRate, setHourlyRate] = useState<number>(currentWorker.hourlyRate || (currentWorker.role === 'specialist' ? 499 : 299));
  const [fixedPrice, setFixedPrice] = useState<number>(currentWorker.fixedPrice || 399);
  const [toolsList, setToolsList] = useState<string[]>(currentWorker.toolsList || []);
  const [newToolInput, setNewToolInput] = useState<string>('');
  const [profileName, setProfileName] = useState(currentWorker.name);
  const [profilePhone, setProfilePhone] = useState(currentWorker.phone);
  const [profileCity, setProfileCity] = useState(currentWorker.city);
  const [profileImage, setProfileImage] = useState(currentWorker.profileImage || '');

  // New Gig Form State
  const [showNewGigModal, setShowNewGigModal] = useState<boolean>(false);
  const [newGigTitle, setNewGigTitle] = useState<string>('');
  const [newGigCategory, setNewGigCategory] = useState<CategoryId>(currentWorker.category || 'ac');
  const [newGigSkills, setNewGigSkills] = useState<string>('');
  const [newGigModel, setNewGigModel] = useState<WorkerPricingModel>('hourly');
  const [newGigBaseFare, setNewGigBaseFare] = useState<number>(150);
  const [newGigHourly, setNewGigHourly] = useState<number>(349);
  const [newGigFixed, setNewGigFixed] = useState<number>(449);
  const [newGigDesc, setNewGigDesc] = useState<string>('');

  useEffect(() => {
    setPricingModel(currentWorker.pricingModel || 'hourly');
    setBaseFare(currentWorker.baseFare || 150);
    setHourlyRate(currentWorker.hourlyRate || (currentWorker.role === 'specialist' ? 499 : 299));
    setFixedPrice(currentWorker.fixedPrice || 399);
    setToolsList(currentWorker.toolsList || []);
    setProfileName(currentWorker.name);
    setProfilePhone(currentWorker.phone);
    setProfileCity(currentWorker.city);
    setProfileImage(currentWorker.profileImage || '');
  }, [selectedWorkerId, currentWorker]);

  // Active task for this worker
  const activeTask = bookings.find(
    b => b.worker?.id === currentWorker.id && b.status !== 'completed' && b.status !== 'cancelled'
  );
  const totalCompletedIncome = sumCompletedWorkerIncome(bookings, currentWorker.id);
  const reminderDeadline = activeTask ? buildReminderDeadline(activeTask.startsAt) : null;
  const reminderCountdownSeconds = reminderDeadline ? Math.max(0, Math.floor((new Date(reminderDeadline).getTime() - Date.now()) / 1000)) : 0;
  const reminderState = activeTask && reminderCountdownSeconds > 0 && reminderCountdownSeconds <= 2 * 60 * 60 ? 'alert' : 'idle';
  const geofenceState = activeTask ? getGeofenceStatus(120, 100, 200) : null;

  // 15-Minute Countdown calculation for unacknowledged task
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number>(900);
  const audioContextRef = useRef<AudioContext | null>(null);

  const refreshData = () => {
    const bks = getSavedBookings();
    setBookings(bks);
    setSpareProducts(getSpareProducts());
    setSpareShops(getSpareShops());
  };

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 3000);
    return () => clearInterval(interval);
  }, []);

  // Web Audio chime bell sound
  const playAlertChime = () => {
    try {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.15); // A5

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.25);
      osc2.start(now + 0.15);
      osc2.stop(now + 1.2);
    } catch (e) {
      console.warn('Audio chime notice:', e);
    }
  };

  // Timer loop for task acknowledgement
  useEffect(() => {
    if (!activeTask || activeTask.timelineStep !== 'assigned') {
      return;
    }

    if (audioEnabled) {
      playAlertChime();
    }

    const timer = setInterval(() => {
      if (!activeTask.acknowledgementDeadline) {
        setTimeLeftSeconds(prev => Math.max(0, prev - 1));
        return;
      }

      const deadline = new Date(activeTask.acknowledgementDeadline).getTime();
      const now = Date.now();
      const diffSeconds = Math.max(0, Math.floor((deadline - now) / 1000));
      setTimeLeftSeconds(diffSeconds);

      if (diffSeconds === 0) {
        clearInterval(timer);
        timeoutAndReassignBooking(activeTask.id).then(() => {
          refreshData();
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [activeTask?.id, activeTask?.timelineStep, activeTask?.acknowledgementDeadline, audioEnabled]);

  const handleAcknowledge = async () => {
    if (!activeTask) return;
    await acknowledgeBooking(activeTask.id);
    refreshData();
  };

  const handleRejectTask = async () => {
    if (!activeTask) return;
    await timeoutAndReassignBooking(activeTask.id);
    refreshData();
  };

  const handleDepartTask = async () => {
    if (!activeTask) return;
    await updateBookingTimeline(activeTask.id, 'on_the_way');
    refreshData();
  };

  const handleStartTask = async () => {
    if (!activeTask) return;
    await updateBookingTimeline(activeTask.id, 'in_progress');
    refreshData();
  };

  const handleTimelineStepChange = async (step: BookingRecord['timelineStep']) => {
    if (!activeTask) return;
    await updateBookingTimeline(activeTask.id, step);
    refreshData();
  };

  const handleSavePricing = () => {
    const updated = updateWorkerProfile(currentWorker.id, {
      pricingModel,
      baseFare: Math.max(150, Number(baseFare) || 150),
      hourlyRate: Number(hourlyRate) || (currentWorker.role === 'specialist' ? 499 : 299),
      fixedPrice: Number(fixedPrice) || 399,
      toolsList
    });
    setWorkers(getWorkers());
    setStatusMessage('Pricing structure and equipped tools updated! Fares will be fetched and visible on customer service booking.');
    setTimeout(() => setStatusMessage(''), 4500);
  };

  const handleSaveProfile = () => {
    updateWorkerProfile(currentWorker.id, {
      name: profileName.trim() || currentWorker.name,
      phone: profilePhone.trim() || currentWorker.phone,
      city: profileCity.trim() || currentWorker.city,
      profileImage
    });
    setWorkers(getWorkers());
    setStatusMessage('Profile and photo updated.');
    setTimeout(() => setStatusMessage(''), 4500);
  };

  const handleProfileImage = (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setProfileImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  const handleAddTool = () => {
    if (!newToolInput.trim()) return;
    if (!toolsList.includes(newToolInput.trim())) {
      const nextTools = [...toolsList, newToolInput.trim()];
      setToolsList(nextTools);
      updateWorkerProfile(currentWorker.id, { toolsList: nextTools });
      setWorkers(getWorkers());
    }
    setNewToolInput('');
  };

  const handleRemoveTool = (toolToRemove: string) => {
    const nextTools = toolsList.filter(t => t !== toolToRemove);
    setToolsList(nextTools);
    updateWorkerProfile(currentWorker.id, { toolsList: nextTools });
    setWorkers(getWorkers());
  };

  const handleCreateGig = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGigTitle.trim()) return;
    const gigSkills = newGigSkills.split(',').map(s => s.trim()).filter(Boolean);

    addWorkerGig(currentWorker.id, {
      title: newGigTitle.trim(),
      category: newGigCategory,
      skills: gigSkills.length ? gigSkills : [newGigTitle.trim()],
      tools: toolsList.slice(0, 4),
      pricingModel: newGigModel,
      baseFare: Math.max(150, Number(newGigBaseFare) || 150),
      hourlyRate: Number(newGigHourly) || 349,
      fixedPrice: Number(newGigFixed) || 449,
      description: newGigDesc.trim() || undefined
    });
    setWorkers(getWorkers());
    setShowNewGigModal(false);
    setNewGigTitle('');
    setNewGigSkills('');
    setNewGigDesc('');
    setStatusMessage(`New Gig "${newGigTitle.trim()}" published live to Repaido customer catalogue!`);
    setTimeout(() => setStatusMessage(''), 4500);
  };

  const handleAddSpare = async (prod: SparePartProduct) => {
    if (!activeTask) return;
    await addTaskSpareToBooking(activeTask.id, prod);
    setShowSpareModal(false);
    refreshData();
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="worker-portal-container bg-slate-100 min-h-screen pb-20 text-sm antialiased">
      {/* Top Bar with Ring Alert Chime, Name & Continuous Shift Notice */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-sm shadow-xs">
              {currentWorker.profileImage ? <img src={currentWorker.profileImage} alt="Worker profile" className="w-full h-full rounded-full object-cover" /> : currentWorker.avatar}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-slate-900 text-sm">{currentWorker.name}</span>
              <span className={`px-2 py-0.5 text-sm rounded-full uppercase tracking-wider font-extrabold ${
                currentWorker.role === 'specialist'
                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                  : 'bg-blue-100 text-blue-900 border border-blue-300'
              }`}>
                {currentWorker.role}
              </span>
            </div>
            <p className="text-sm text-slate-500 font-medium">Continuous Shift Mode • {currentWorker.city} Service Radius</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Audio Chime Bell Toggle */}
          <button
            type="button"
            onClick={() => {
              setAudioEnabled(prev => !prev);
              playAlertChime();
            }}
            className={`p-2 rounded-lg border transition-all ${
              audioEnabled ? 'bg-emerald-50 border-emerald-400 text-emerald-700 shadow-xs' : 'bg-slate-100 border-slate-200 text-slate-500'
            }`}
            title="Toggle Ring Bell Alert Chime"
          >
            <Bell className={`w-4 h-4 ${audioEnabled ? 'animate-bounce text-emerald-600' : ''}`} />
          </button>

          {/* Quick worker switcher */}
          <select
            value={selectedWorkerId}
            onChange={e => setSelectedWorkerId(e.target.value)}
            className="bg-slate-100 text-xs border border-slate-300 text-slate-800 rounded px-2.5 py-1.5 focus:outline-none focus:border-emerald-600 font-medium"
            title="Switch technician profile"
          >
            {workers.map(w => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.role} - {w.points} pts / {w.completedTasks} tasks)
              </option>
            ))}
          </select>

          {onBackToCustomerApp && (
            <button
              onClick={onBackToCustomerApp}
              className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-2.5 py-1.5 rounded border border-slate-300 ml-1 transition-all"
            >
              Exit View
            </button>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              className="text-sm bg-red-50 hover:bg-red-100 text-red-700 font-medium px-2.5 py-1.5 rounded border border-red-200 ml-1 transition-all"
            >
              Logout
            </button>
          )}
        </div>
      </header>

      {/* Specialist Badge Progression Tracker (Clean Light Card) */}
      <section className="px-4 py-3.5 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <Award className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-bold text-slate-800">
              {progress.badgeTitle}
            </span>
          </div>
          <span className="text-sm font-extrabold text-emerald-700">
            {progress.isSpecialistEligible ? 'Specialist Badge Unlocked' : `${progress.progressPercent}% to Specialist`}
          </span>
        </div>

        {/* Dual rule progress bar */}
        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden mb-2.5 border border-slate-200">
          <div
            className="bg-gradient-to-r from-emerald-500 to-amber-500 h-2.5 rounded-full transition-all duration-500"
            style={{ width: `${progress.progressPercent}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div className="text-slate-500 font-medium">Points Rule (Target 1,500)</div>
            <div className="font-extrabold text-slate-900 text-xs mt-0.5">
              {currentWorker.points} / 1,500 pts
              {currentWorker.points >= 1500 ? (
                <span className="text-emerald-700 font-bold ml-1">✓ Passed</span>
              ) : (
                <span className="text-slate-500 font-normal ml-1">({progress.remainingPoints} to go)</span>
              )}
            </div>
          </div>
          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div className="text-slate-500 font-medium">Task Rule (Target 20 Tasks)</div>
            <div className="font-extrabold text-slate-900 text-xs mt-0.5">
              {currentWorker.completedTasks} / 20 tasks
              {currentWorker.completedTasks >= 20 ? (
                <span className="text-emerald-700 font-bold ml-1">✓ Passed</span>
              ) : (
                <span className="text-slate-500 font-normal ml-1">({progress.remainingTasks} left)</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold uppercase tracking-wide text-emerald-700">Settled income</div>
              <div className="text-sm font-extrabold text-slate-900">{formatMoney(totalCompletedIncome)}</div>
            </div>
          </div>
          <div className="text-right text-sm text-slate-600">
            <div className="font-medium">Completed paid tasks</div>
            <div className="font-bold text-slate-900">{bookings.filter(b => b.worker?.id === currentWorker.id && b.status === 'completed').length}</div>
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-1.5 text-sm text-slate-600 font-medium">
          <Wrench className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
          <span>Equipped: <strong className="text-slate-800">{progress.unlockedKit}</strong> • 3% Repaido labor platform fee</span>
        </div>
      </section>

      {/* Worker Portal View Switcher: Home / Tasks / Profile */}
      <div className="px-4 pt-3 max-w-2xl mx-auto">
        <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 border border-slate-200 shadow-2xs">
          <button
            type="button"
            onClick={() => setPortalTab('home')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              portalTab === 'home'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Home className="w-3.5 h-3.5 text-emerald-600" />
            <span>Home</span>
          </button>
          <button
            type="button"
            onClick={() => setPortalTab('tasks')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              portalTab === 'tasks'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>Active Task</span>
            {activeTask && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping ml-1" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setPortalTab('profile')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              portalTab === 'profile'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Settings className="w-3.5 h-3.5 text-slate-600" />
            <span>Profile</span>
          </button>
        </div>

        {statusMessage && (
          <div className="mt-2.5 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-in fade-in duration-200">
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>

      {/* Main Work Area */}
      <main className="p-4 space-y-4 max-w-2xl mx-auto">
        {portalTab === 'home' ? (
          <div className="space-y-4 pt-2">
            <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-amber-50 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-700">Today’s earnings</p>
                  <h3 className="mt-1 text-2xl font-black text-slate-900">₹{Math.max(0, Math.round(totalCompletedIncome || currentWorker.hourlyRate || 299)).toLocaleString('en-IN')}</h3>
                </div>
                <div className="rounded-xl bg-emerald-600 px-3 py-2 text-white shadow-sm">
                  <div className="text-sm uppercase tracking-[0.2em] text-emerald-100">Payout</div>
                  <div className="text-lg font-black">{currentWorker.completedTasks} jobs</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPortalTab('tasks')}
                className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left shadow-sm"
              >
                <div className="flex items-center gap-2 text-amber-700"><Clock className="w-5 h-5" /><span className="text-xs font-bold uppercase tracking-[0.14em]">Task</span></div>
                <div className="mt-2 text-xl font-black text-slate-900">{activeTask ? 'Live' : 'Ready'}</div>
              </button>
              <button
                type="button"
                onClick={() => setPortalTab('profile')}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left shadow-sm"
              >
                <div className="flex items-center gap-2 text-slate-700"><Settings className="w-5 h-5" /><span className="text-xs font-bold uppercase tracking-[0.14em]">Profile</span></div>
                <div className="mt-2 text-xl font-black text-slate-900">{currentWorker.role}</div>
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-900">Work summary</h4>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-bold text-emerald-800">online</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 p-3"><div className="text-sm text-slate-500">Tasks</div><div className="text-lg font-black text-slate-900">{currentWorker.completedTasks}</div></div>
                <div className="rounded-lg bg-slate-50 p-3"><div className="text-sm text-slate-500">Score</div><div className="text-lg font-black text-slate-900">{currentWorker.taskScore.toFixed(1)}</div></div>
                <div className="rounded-lg bg-slate-50 p-3"><div className="text-sm text-slate-500">City</div><div className="text-sm font-black text-slate-900">{currentWorker.city}</div></div>
              </div>
            </div>
          </div>
        ) : portalTab === 'tasks' ? (
          <>
            {/* If an unacknowledged task exists: STICKY MODAL / BANNER WITH 15-MINUTE COUNTDOWN */}
            {activeTask && activeTask.timelineStep === 'assigned' && (
              <div className="task-acknowledgement-card bg-amber-50 border-2 border-amber-500 rounded-xl p-4 shadow-md animate-pulse-border text-amber-950">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-600"></span>
                    </span>
                    <span className="text-xs font-extrabold text-amber-900 uppercase tracking-wide">
                      New Task Assigned ({activeTask.city})
                    </span>
                  </div>
                  <div className="flex items-center gap-1 bg-amber-100 border border-amber-300 px-2.5 py-1 rounded text-amber-900 text-xs font-mono font-extrabold">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatTimer(timeLeftSeconds)}</span>
                  </div>
                </div>

                <p className="text-xs text-amber-900/90 mb-3 leading-relaxed">
                  <strong>Notice:</strong> You have strictly 15 minutes to acknowledge this assignment. If not confirmed before 00:00,
                  the Discovery Engine will automatically reassign this request to the next ranked technician.
                </p>

                {reminderState === 'alert' && reminderDeadline && (
                  <div className="mb-3 rounded-lg border border-amber-300 bg-amber-100/70 p-2.5 text-sm text-amber-900">
                    <div className="flex items-center justify-between gap-2 font-bold">
                      <span>2-hour task reminder</span>
                      <span>{formatTimer(reminderCountdownSeconds)}</span>
                    </div>
                    <div className="mt-1">Get your tools and spare parts ready before the customer’s requested time.</div>
                  </div>
                )}

                <div className="bg-white p-3 rounded-lg border border-amber-200 text-xs space-y-1.5 mb-3.5 shadow-xs">
                  <div className="text-slate-900 font-bold text-sm">{activeTask.serviceName}</div>
                  <div className="text-slate-600 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-red-500" />
                    <span>{activeTask.address}</span>
                  </div>
                  <div className="text-emerald-700 font-extrabold text-xs">
                    Task Value: {formatMoney(activeTask.price)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button
                    type="button"
                    onClick={handleAcknowledge}
                    className="py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg flex items-center justify-center gap-2 shadow transition-all text-xs"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Acknowledge</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRejectTask}
                    className="py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 shadow transition-all text-xs"
                  >
                    <X className="w-4 h-4" />
                    <span>Reject</span>
                  </button>
                </div>
              </div>
            )}

            {/* Active Confirmed Task Card */}
            {activeTask && activeTask.timelineStep !== 'assigned' ? (
              <div className="active-task-detail-card bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-sm font-bold tracking-wider uppercase text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Active In-Flight Task
                    </span>
                    <h3 className="text-base font-bold text-slate-900 mt-1">{activeTask.serviceName}</h3>
                    <p className="text-xs text-slate-500">Task ID: {activeTask.id}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-extrabold text-slate-900 font-mono">
                      {formatMoney(activeTask.price)}
                    </div>
                    <span className="text-sm text-slate-500 font-medium">Billed to customer</span>
                  </div>
                </div>

                {/* Android Linear Workflow Stepper */}
                <div className="border-t border-b border-slate-200 py-3">
                  <div className="text-xs font-bold text-slate-800 mb-2.5 flex items-center gap-1.5">
                    <Navigation className="w-4 h-4 text-blue-600" />
                    <span>Task Progression Stage</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { step: 'acknowledged' as const, label: '1. Confirmed' },
                      { step: 'on_the_way' as const, label: '2. On The Way' },
                      { step: 'in_progress' as const, label: '3. In Progress' },
                      { step: 'completed' as const, label: '4. Finished' }
                    ].map(s => {
                      const isCurrent = activeTask.timelineStep === s.step;
                      const stepsOrder = ['assigned', 'acknowledged', 'on_the_way', 'in_progress', 'completed'];
                      const currentIdx = stepsOrder.indexOf(activeTask.timelineStep || 'assigned');
                      const stepIdx = stepsOrder.indexOf(s.step);
                      const isDone = currentIdx >= stepIdx;

                      return (
                        <button
                          key={s.step}
                          type="button"
                          onClick={() => handleTimelineStepChange(s.step)}
                          className={`p-2 rounded-lg text-xs transition-all border text-center ${
                            isCurrent
                              ? 'bg-emerald-600 text-white border-emerald-600 font-bold shadow-xs'
                              : isDone
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-semibold'
                              : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <div>{s.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Customer Location & Contact */}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-2">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900">Customer Repair Site</div>
                      <div className="text-slate-600">{activeTask.address}, {activeTask.city}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-sm">
                    <span className="text-slate-500">Scheduled: {activeTask.startsAt}</span>
                    <span className="text-emerald-700 font-bold">Labor Charge: {formatMoney(activeTask.laborCharge || activeTask.price)}</span>
                  </div>
                </div>

                {reminderDeadline && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
                    <div className="flex items-center justify-between gap-2 font-bold">
                      <span>Reminder timer</span>
                      <span>{formatTimer(Math.max(0, reminderCountdownSeconds))}</span>
                    </div>
                    <div className="mt-1">{geofenceState ? geofenceState.message : 'Prepare for the next customer checkpoint.'}</div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleDepartTask}
                    disabled={activeTask.timelineStep === 'on_the_way' || activeTask.timelineStep === 'in_progress' || activeTask.timelineStep === 'completed'}
                    className="py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white text-xs font-bold"
                  >
                    Depart for task
                  </button>
                  <button
                    type="button"
                    onClick={handleStartTask}
                    disabled={activeTask.timelineStep === 'in_progress' || activeTask.timelineStep === 'completed'}
                    className="py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white text-xs font-bold"
                  >
                    Start task
                  </button>
                </div>

                {/* In-Task Spare Parts Section */}
                <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <ShoppingBag className="w-3.5 h-3.5 text-amber-600" />
                        <span>In-Task Spare Part Procurement</span>
                      </h4>
                      <p className="text-sm text-slate-500 font-medium">
                        Billed to customer invoice • ₹10/km 2-way travel charge included
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSpareModal(true)}
                      className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-bold flex items-center gap-1 shadow-xs transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Spare Part</span>
                    </button>
                  </div>

                  {/* Added Spare Parts List */}
                  {activeTask.taskSpares && activeTask.taskSpares.length > 0 ? (
                    <div className="space-y-2">
                      {activeTask.taskSpares.map(sp => {
                        const isWithin100Meters = simulatedWorkerDistanceToShop <= 100;

                        return (
                          <div key={sp.id} className="bg-white p-3 rounded-lg border border-slate-200 text-xs space-y-2.5 shadow-xs">
                            <div className="flex items-start gap-3">
                              {sp.image ? (
                                <img
                                  src={sp.image}
                                  alt={sp.name}
                                  className="w-14 h-14 rounded-lg object-contain border border-slate-200 bg-white p-1 flex-shrink-0 shadow-2xs"
                                />
                              ) : (
                                <div className="w-14 h-14 rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-400">
                                  <ShoppingBag className="w-6 h-6" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-slate-900 truncate">{sp.name}</span>
                                  <span className="font-extrabold text-emerald-700 font-mono ml-2">₹{sp.totalBilledToCustomer}</span>
                                </div>
                                <div className="text-sm text-slate-500 mt-1 flex flex-wrap items-center justify-between gap-1">
                                  <span>From: <strong className="text-slate-700">{sp.shopName}</strong></span>
                                  <span className="text-amber-800 font-medium">Distance: {sp.travelDistanceKm} km (₹{sp.travelCharge} travel)</span>
                                </div>
                              </div>
                            </div>

                            {/* Safety Distance Check & Contact Details Masking */}
                            <div className={`p-2 rounded-lg text-sm border ${
                              isWithin100Meters
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                : 'bg-amber-50 border-amber-300 text-amber-900'
                            }`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-bold flex items-center gap-1">
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>Worker Distance to Shop: {simulatedWorkerDistanceToShop}m</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setSimulatedWorkerDistanceToShop(prev => (prev > 100 ? 60 : 180))}
                                  className="text-sm underline font-semibold text-slate-600 hover:text-slate-900"
                                >
                                  [Simulate {simulatedWorkerDistanceToShop > 100 ? 'Approach (<100m)' : 'Away (>100m)'}]
                                </button>
                              </div>

                              {isWithin100Meters ? (
                                <div className="flex items-center justify-between pt-1">
                                  <span className="font-mono font-bold text-slate-900 flex items-center gap-1">
                                    <Phone className="w-3.5 h-3.5 text-emerald-600" />
                                    {sp.shopPhone}
                                  </span>
                                  <span className="text-sm bg-emerald-700 px-2 py-0.5 rounded text-white font-bold">
                                    Within 100m • Verified
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between text-amber-900 pt-1">
                                  <span className="font-mono text-slate-500">
                                    +91 ••••• ••••
                                  </span>
                                  <span className="text-sm bg-amber-200/80 px-2 py-0.5 rounded text-amber-900 font-semibold border border-amber-300">
                                    Hidden for Safety (&gt;100m)
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Status update buttons */}
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-sm text-slate-500 font-medium capitalize">Status: {sp.status.replace(/_/g, ' ')}</span>
                              <div className="flex gap-1.5">
                                {sp.status === 'added_to_task' && (
                                  <button
                                    type="button"
                                    onClick={() => updateTaskSpareStatus(activeTask.id, sp.id, 'agent_picked_up')}
                                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-sm text-white rounded font-bold transition-all"
                                  >
                                    Mark Picked Up
                                  </button>
                                )}
                                {sp.status === 'agent_picked_up' && (
                                  <button
                                    type="button"
                                    onClick={() => updateTaskSpareStatus(activeTask.id, sp.id, 'installed')}
                                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-sm text-white rounded font-bold transition-all"
                                  >
                                    Mark Installed
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-xs text-slate-500 bg-white rounded-lg border border-dashed border-slate-300">
                      No extra spare parts added to this task yet.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-3 shadow-xs">
                <Compass className="w-12 h-12 text-slate-400 mx-auto animate-spin-slow" />
                <h3 className="text-base font-bold text-slate-900">Standby for Assigned Tasks</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  Your service coverage is active in {currentWorker.city}. When a customer books a repair,
                  the Discovery Engine ranks and assigns eligible requests here with ring bell alerts.
                </p>
              </div>
            )}
          </>
        ) : (
          <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4 shadow-xs">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-emerald-600" />
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">Profile Settings</h2>
                <p className="text-sm text-slate-500">Keep the details customers see during discovery up to date.</p>
              </div>
            </div>
            <label className="block text-xs font-bold text-slate-700">Profile picture</label>
            <div className="flex items-center gap-3">
              {profileImage ? <img src={profileImage} alt="Worker profile preview" className="w-16 h-16 rounded-full object-cover border border-slate-200" /> : <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400"><ImagePlus className="w-5 h-5" /></div>}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => handleProfileImage(e.target.files?.[0])} className="text-xs text-slate-600" />
            </div>
            <label className="block text-xs font-bold text-slate-700">Full name<input value={profileName} onChange={e => setProfileName(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-xs" /></label>
            <label className="block text-xs font-bold text-slate-700">Phone<input value={profilePhone} onChange={e => setProfilePhone(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-xs" /></label>
            <label className="block text-xs font-bold text-slate-700">Service city<input value={profileCity} onChange={e => setProfileCity(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-xs" /></label>
            <button type="button" onClick={handleSaveProfile} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 text-xs font-bold flex items-center justify-center gap-2"><Save className="w-4 h-4" /> Save profile changes</button>
          </section>
        )}
      </main>

      <nav className="sticky bottom-0 z-30 mt-4 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur-sm md:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setPortalTab('home')}
            className={`rounded-xl px-2 py-2 text-sm font-bold ${portalTab === 'home' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            <div className="flex flex-col items-center gap-1"><Home className="w-4 h-4" /><span>Home</span></div>
          </button>
          <button
            type="button"
            onClick={() => setPortalTab('tasks')}
            className={`rounded-xl px-2 py-2 text-sm font-bold ${portalTab === 'tasks' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            <div className="flex flex-col items-center gap-1"><Clock className="w-4 h-4" /><span>Active task</span></div>
          </button>
          <button
            type="button"
            onClick={() => setPortalTab('profile')}
            className={`rounded-xl px-2 py-2 text-sm font-bold ${portalTab === 'profile' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            <div className="flex flex-col items-center gap-1"><Settings className="w-4 h-4" /><span>Profile</span></div>
          </button>
        </div>
      </nav>

      {/* MODAL: Select Spare Part from Local Partner Shops (Light Pure Theme) */}
      {showSpareModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <ShoppingBag className="w-4 h-4 text-emerald-600" />
                  <span>Repaido Partner Spare Inventory</span>
                </h3>
                <p className="text-sm text-slate-500">
                  Real stock only • Cashless pickup • Billed directly to customer task
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSpareModal(false)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold px-2"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              {spareProducts.map(prod => {
                const shop = spareShops.find(s => s.id === prod.shopId);
                const distanceKm = shop ? calculateDistanceKm(21.4934, 86.9135, shop.lat, shop.lng) : 2.5;
                const travelCharge = Math.max(20, Math.round(distanceKm * 2 * 10));

                return (
                  <div key={prod.id} className="bg-slate-50 hover:bg-white p-3 rounded-lg border border-slate-200 flex items-start justify-between gap-3 transition-colors shadow-2xs">
                    <div className="flex items-start gap-2.5">
                      {prod.image ? (
                        <img
                          src={prod.image}
                          alt={prod.name}
                          className="w-12 h-12 rounded-lg object-contain border border-slate-200 bg-white p-0.5 flex-shrink-0 shadow-2xs"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-400">
                          <ShoppingBag className="w-5 h-5" />
                        </div>
                      )}
                      <div className="space-y-1">
                        <div className="font-bold text-slate-900 text-xs">{prod.name}</div>
                        <div className="text-sm text-slate-500">
                          {prod.brand} • SKU: {prod.partNumber}
                        </div>
                        <div className="text-sm text-slate-600 flex items-center gap-2">
                          <span>Shop: <strong>{prod.shopName}</strong></span>
                          <span>• Stock: <strong className="text-emerald-700">{prod.stock} units</strong></span>
                        </div>
                        <div className="text-sm text-amber-800 font-semibold">
                          2-Way Travel ({distanceKm} km × 2 × ₹10): +₹{travelCharge}
                        </div>
                      </div>
                    </div>

                    <div className="text-right flex flex-col items-end justify-between self-stretch">
                      <div className="text-sm font-extrabold text-slate-900 font-mono">₹{prod.price}</div>
                      <button
                        type="button"
                        onClick={() => handleAddSpare(prod)}
                        className="mt-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-xs transition-all"
                      >
                        Add to Task
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 text-sm text-slate-600 text-center font-medium">
              Settled weekly on Wednesday • 5% platform commission recorded to shop ledger
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Publish New Gig & Skills Offering */}
      {showNewGigModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full max-h-[90vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  <span>List New Gig on Repaido</span>
                </h3>
                <p className="text-sm text-slate-500">
                  Visible to all customers searching for specialist repairs in {currentWorker.city}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewGigModal(false)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold px-2"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateGig} className="p-4 overflow-y-auto space-y-3.5 flex-1 text-xs">
              <div>
                <label className="block font-bold text-slate-800 mb-1">Gig Title / Skill Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Inverter AC PCB Soldering & Gas Charging"
                  value={newGigTitle}
                  onChange={e => setNewGigTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Service Category</label>
                  <select
                    value={newGigCategory}
                    onChange={e => setNewGigCategory(e.target.value as CategoryId)}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-blue-600 bg-white"
                  >
                    <option value="ac">AC Service</option>
                    <option value="plumber">Plumbing</option>
                    <option value="electrician">Electrician</option>
                    <option value="cleaning">Cleaning</option>
                    <option value="car">Car Care</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-800 mb-1">Pricing Model</label>
                  <select
                    value={newGigModel}
                    onChange={e => setNewGigModel(e.target.value as WorkerPricingModel)}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-blue-600 bg-white font-bold"
                  >
                    <option value="hourly">Hourly + Base Fare</option>
                    <option value="fixed">Fixed Cost</option>
                  </select>
                </div>
              </div>

              {newGigModel === 'hourly' ? (
                <div className="grid grid-cols-2 gap-2 bg-blue-50/60 p-2.5 rounded-lg border border-blue-100">
                  <div>
                    <label className="block font-bold text-blue-900 mb-1">Base Fare (Min ₹150)</label>
                    <input
                      type="number"
                      min={150}
                      value={newGigBaseFare}
                      onChange={e => setNewGigBaseFare(Math.max(150, Number(e.target.value)))}
                      className="w-full px-2.5 py-1.5 border border-blue-200 rounded-md text-xs font-mono font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-blue-900 mb-1">Hourly Rate (₹/hr)</label>
                    <input
                      type="number"
                      min={199}
                      value={newGigHourly}
                      onChange={e => setNewGigHourly(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 border border-blue-200 rounded-md text-xs font-mono font-bold bg-white"
                    />
                  </div>
                </div>
              ) : (
                <div className="bg-blue-50/60 p-2.5 rounded-lg border border-blue-100">
                  <label className="block font-bold text-blue-900 mb-1">Fixed Service Price (₹)</label>
                  <input
                    type="number"
                    min={249}
                    value={newGigFixed}
                    onChange={e => setNewGigFixed(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 border border-blue-200 rounded-md text-xs font-mono font-bold bg-white"
                  />
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-800 mb-1">Specialized Skills (comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g. Copper brazing, leak detection, multi-split VRV"
                  value={newGigSkills}
                  onChange={e => setNewGigSkills(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">Gig Scope & Highlights</label>
                <textarea
                  rows={2}
                  placeholder="Detailed description of the diagnostic and repair procedure..."
                  value={newGigDesc}
                  onChange={e => setNewGigDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs shadow-xs transition-all mt-2"
              >
                Publish Gig to Platform
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
