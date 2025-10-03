export default function KPICard({ label, value, suffix=''}: { label: string; value: string|number; suffix?: string }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 p-4 shadow flex flex-col">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-2xl font-semibold">{value}{suffix}</span>
    </div>
  );
}
