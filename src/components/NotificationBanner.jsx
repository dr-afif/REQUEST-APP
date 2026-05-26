import { useMemo } from 'react';

export default function NotificationBanner({ requests = [], shiftBlocks = [], activities = [], onBannerClick }) {
  const announcements = useMemo(() => {
    const list = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isPastDate = (dateStr) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      d.setHours(0, 0, 0, 0);
      return d < today;
    };

    // Process manually managed activities
    (activities || []).forEach((act) => {
      if (act.Status && act.Status.toLowerCase() === 'archived') return;
      if (isPastDate(act.Date)) return;

      if (act.CustomText) {
        // Custom megaphone announcement
        const ts = act.Timestamp ? new Date(act.Timestamp).getTime() : 0;
        list.push({
          text: act.CustomText,
          timeScore: ts
        });
      } else {
        // Roster activity log
        const ts = act.Timestamp ? new Date(act.Timestamp).getTime() : 0;
        const formattedDate = act.Date ? new Date(act.Date).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }) : 'TBD';
        
        const isSwap = act.RequestType?.toLowerCase() === 'swap';
        let text = '';
        if (isSwap) {
          text = `🔄 Shift Swap Approved: ${act.Name} swapped duties for ${formattedDate} with ${act.SwapPartner || 'Partner'}.`;
        } else {
          text = `🌴 Shift Change: ${act.Name}'s request for ${act.Request || 'Off'} on ${formattedDate} has been approved.`;
        }
        list.push({
          text,
          timeScore: ts
        });
      }
    });

    // Sort by timeScore descending (newest first)
    list.sort((a, b) => b.timeScore - a.timeScore);

    // Map to the text of the notifications (no slice/limit)
    const limitedList = list.map((item) => item.text);

    // Fallback standard announcement if empty
    if (limitedList.length === 0) {
      limitedList.push('📢 Welcome to the ED Roster portal! Select your member profile to view shifts, request changes, or process swaps online.');
      limitedList.push('✨ Quick Tip: You can now copy-paste full months of rosters directly from Microsoft Excel or Google Sheets in the Admin Panel.');
    }

    return limitedList;
  }, [activities]);

  const fullText = useMemo(() => {
    if (announcements.length === 0) return '';
    const combined = announcements.join('   •   ');
    // Ensure the marquee text is long enough to span any screen size seamlessly
    let repeated = combined;
    while (repeated.length < 450) {
      repeated += '   •   ' + combined;
    }
    return repeated;
  }, [announcements]);

  const speedFactor = 12; // chars per second
  const duration = Math.max(15, Math.round(fullText.length / speedFactor));

  return (
    <div 
      onClick={onBannerClick}
      role="button"
      className="group relative flex h-7 items-center overflow-hidden border-b border-indigo-100 bg-gradient-to-r from-indigo-600 to-indigo-700 text-xs font-semibold text-white shadow-inner cursor-pointer select-none"
      title="Click to view detailed updates feed"
      style={{ '--marquee-duration': `${duration}s` }}
    >
      <div className="absolute left-0 z-10 flex h-full items-center bg-indigo-800 px-3 shadow-md">
        <span>BULLETIN</span>
      </div>

      <div className="flex w-full overflow-hidden pl-24">
        <div className="flex animate-marquee py-1">
          <span className="whitespace-nowrap pr-24">{fullText}</span>
          <span className="whitespace-nowrap pr-24">{fullText}</span>
        </div>
      </div>

      {/* Styled inline keyframes so marquee works without complex tailwind configurations */}
      <style>{`
        @keyframes marqueeScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          display: flex;
          white-space: nowrap;
          animation: marqueeScroll var(--marquee-duration, 45s) linear infinite;
        }
        .animate-marquee:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
