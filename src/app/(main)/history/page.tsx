'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronRight, Dumbbell, Bike, HeartPulse, Search, StickyNote } from 'lucide-react';
import { useDb, useSp } from '@/components/client/DataProvider';
import { getProfile, getSettings } from '@/lib/repo/settings';
import { all } from '@/lib/db';
import { searchNotes } from '@/lib/repo/logs';
import { listCardio } from '@/lib/repo/workouts';
import { weeklyReview } from '@/lib/domain/summary';
import { addDays, formatMedium, formatMinutes, formatShort, startOfWeek, today as getToday } from '@/lib/dates';
import { fmtNum, weightFromLb } from '@/lib/units';
import { Card, CardTitle, Delta, EmptyState, PageHeader } from '@/components/ui';
import { LogButton } from '@/components/client/Actions';
import { DeletableRow } from '@/components/client/Lists';

function HistoryPage() {
  const sp = useSp();
  const q = typeof sp.q === 'string' ? sp.q : '';
  const { db } = useDb();
  const today = getToday();
  const s = getSettings(db);
  const profile = getProfile(db);
  const sessions = all<{ id: number; date: string; title: string; kind: string; status: string; notes: string | null; sets: number; cardio: number }>(db,
    `SELECT ws.id, ws.date, ws.title, ws.kind, ws.status, ws.notes,
            (SELECT COUNT(*) FROM set_log s JOIN exercise_session es ON es.id = s.exercise_session_id WHERE es.workout_session_id = ws.id) AS sets,
            (SELECT COALESCE(SUM(duration_min), 0) FROM cardio_session c WHERE c.workout_session_id = ws.id) AS cardio
       FROM workout_session ws WHERE ws.status != 'abandoned' ORDER BY ws.date DESC, ws.id DESC LIMIT 60`);
  const standalone = listCardio(db, addDays(today, -90), today).filter((c) => !c.workout_session_id);
  const notes = searchNotes(db, q, q ? 100 : 30);

  type Entry = { date: string; key: string; node: React.ReactNode };
  const timeline: Entry[] = [
    ...sessions.map((w) => ({
      date: w.date, key: `w${w.id}`,
      node: (
        <Link href={`/history/view?id=${w.id}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-3 hover:bg-surface-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-2">{w.kind === 'strength' ? <Dumbbell className="size-4" aria-hidden /> : <HeartPulse className="size-4" aria-hidden />}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{w.title}{w.status === 'in_progress' && <span className="ml-2 text-xs font-semibold text-warn-text">In progress</span>}</span>
            <span className="num block truncate text-sm text-fg-3">{[w.sets ? `${w.sets} sets` : null, w.cardio ? `${fmtNum(w.cardio, 0)} min cardio` : null, w.notes].filter(Boolean).join(' · ')}</span>
          </span>
          <ChevronRight className="size-4 text-fg-3" aria-hidden />
        </Link>
      ),
    })),
    ...standalone.map((c) => ({
      date: c.date, key: `c${c.id}`,
      node: (
        <div className="flex items-center gap-3 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-2"><Bike className="size-4" aria-hidden /></span>
          <span className="flex-1"><span className="block font-medium">{c.modality}</span><span className="num block text-sm text-fg-3">{fmtNum(c.duration_min, 0)} min{c.intensity ? ` · ${c.intensity}` : ''}</span></span>
        </div>
      ),
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const byDate = new Map<string, Entry[]>();
  for (const e of timeline) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  const weeks: string[] = [];
  for (let w = startOfWeek(today); w >= startOfWeek(profile.program_start_date) && weeks.length < 12; w = addDays(w, -7)) weeks.push(w);
  const reviews = weeks.map((w) => weeklyReview(db, w, today));

  return (
    <div className="space-y-6">
      <PageHeader title="History" subtitle="Workouts, weekly reviews and journal" action={<LogButton tab="note" size="md">Add note</LogButton>} />

      <form role="search" className="relative" action="/history">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
        <label className="sr-only" htmlFor="q">Search notes</label>
        <input id="q" name="q" defaultValue={q} className="input h-12 rounded-full pl-11" placeholder="Search notes — “knee”, “bike”, “sleep”…" />
      </form>

      {(q || notes.length > 0) && (
        <Card>
          <CardTitle>{q ? `Notes matching “${q}”` : 'Journal'}</CardTitle>
          {notes.length ? (
            <ul className="divide-y divide-line">
              {notes.map((n) => n.kind === 'note' ? (
                <DeletableRow key={`n${n.id}`} kind="note" id={n.id} label="note">
                  <p className="text-[15px]">{n.body}</p>
                  <p className="text-xs text-fg-3">{formatMedium(n.date)}</p>
                </DeletableRow>
              ) : (
                <li key={`${n.kind}${n.id}`} className="py-2.5">
                  <Link href={`/history/view?id=${n.ref_id}`} className="block hover:underline">
                    <p className="text-[15px]">{n.body}</p>
                    <p className="text-xs text-fg-3">{formatMedium(n.date)} · {n.kind === 'workout' ? n.context : `${n.context} (exercise note)`}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-fg-3">No notes match.</p>}
        </Card>
      )}

      <Card>
        <CardTitle>Weekly reviews</CardTitle>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="text-xs text-fg-3">
                <th scope="col" className="px-2 py-2 font-medium">Week</th>
                <th scope="col" className="px-2 py-2 font-medium">Weight</th>
                <th scope="col" className="px-2 py-2 font-medium">Strength</th>
                <th scope="col" className="px-2 py-2 font-medium">Cardio</th>
                <th scope="col" className="px-2 py-2 font-medium">Protein</th>
                <th scope="col" className="px-2 py-2 font-medium">Sleep</th>
                <th scope="col" className="px-2 py-2 font-medium">PRs</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line">
              {reviews.map((r) => (
                <tr key={r.weekStart}>
                  <td className="px-2 py-2.5"><Link href={`/progress?week=${r.weekStart}`} className="font-medium hover:underline">Week {r.programWeek}</Link><span className="block text-xs text-fg-3">{formatShort(r.weekStart)}</span></td>
                  <td className="px-2 py-2.5">{r.weight.change != null ? <Delta value={weightFromLb(r.weight.change, s.weightUnit)} unit={` ${s.weightUnit}`} /> : '—'}</td>
                  <td className="px-2 py-2.5">{r.strength.done}/{r.strength.target}</td>
                  <td className="px-2 py-2.5">{r.cardioMinutes} min</td>
                  <td className="px-2 py-2.5">{r.protein.hit}/{r.protein.days}</td>
                  <td className="px-2 py-2.5">{r.sleep.avg != null ? formatMinutes(r.sleep.avg) : '—'}</td>
                  <td className="px-2 py-2.5">{r.prs.length || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>Activity</CardTitle>
        {byDate.size === 0 ? (
          <EmptyState icon={<StickyNote className="size-6" />} title="No workouts yet">Your completed workouts and cardio will appear here.</EmptyState>
        ) : (
          <div className="space-y-4">
            {[...byDate.entries()].map(([date, entries]) => (
              <section key={date}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-3">{formatMedium(date)}</h3>
                <ul className="divide-y divide-line">{entries.map((e) => <li key={e.key}>{e.node}</li>)}</ul>
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HistoryPage />
    </Suspense>
  );
}
