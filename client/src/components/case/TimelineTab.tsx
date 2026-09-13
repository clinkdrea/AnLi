import { useEffect, useState } from 'react';
import { FileText, Flag, CheckCircle } from 'lucide-react';

export default function TimelineTab({ caseId }: { caseId: string }) {
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    fetch(`/api/cases/${caseId}/timeline`, { credentials: 'include' })
      .then((r) => r.json()).then((d) => setEvents(d.events || []));
  }, [caseId]);

  const icon = (type: string) => {
    if (type === 'note') return <FileText className="w-4 h-4 text-blue-500" />;
    if (type === 'stage_start') return <Flag className="w-4 h-4 text-amber-500" />;
    if (type === 'stage_done') return <CheckCircle className="w-4 h-4 text-green-500" />;
    return <CheckCircle className="w-4 h-4 text-slate-500" />;
  };

  return (
    <div className="bg-white rounded shadow p-6">
      {events.length === 0 && <div className="text-center text-slate-400 py-8">暂无大事记</div>}
      <div className="relative">
        <div className="absolute left-[15px] top-0 bottom-0 w-px bg-slate-200" />
        <div className="space-y-4">
          {events.map((e, i) => (
            <div key={i} className="flex gap-4 relative">
              <div className="w-8 h-8 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center z-10 shrink-0">
                {icon(e.type)}
              </div>
              <div className="flex-1 pt-1">
                <div className="text-xs text-slate-400 mb-1">{e.time}</div>
                <div className="text-sm">
                  {e.author && <span className="text-slate-500 mr-1">{e.author}：</span>}
                  {e.content}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
