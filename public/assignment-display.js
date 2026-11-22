// Creation times and days remaining are presented using the browser's local calendar.
export function assignmentDateLabel(createdAt, expiresAt, now = new Date()) {
  const created=new Date(createdAt*1000), expires=new Date(expiresAt*1000);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-AU',{hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(created).map(part=>[part.type,part.value]));
  const time=`${parts.hour}:${parts.minute} ${parts.dayPeriod.toUpperCase()}`;
  const date=created.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
  const calendarDay=value=>Date.UTC(value.getFullYear(),value.getMonth(),value.getDate());
  const days=Math.max(0,Math.round((calendarDay(expires)-calendarDay(now))/86400000));
  const expiry=expires<=now?'expired':`exp ${days}d`;
  return `${time}, ${date} (${expiry})`;
}

// An Arcade stage spans many independent questions; its check count is not a retry count.
export function assignmentProgressDot(player, answer) {
  const arcade=player==='arcade';
  const state=answer?.correct===true ? (answer.helped || (!arcade && answer.checks>1) ? 'helped' : 'first') : answer?.skipped ? 'skipped' : 'untried';
  const label=arcade&&answer?.correct===true ? (answer.helped ? 'Stage cleared with Help Me' : 'Stage cleared')
    : state==='first'?'Correct first try':state==='helped'?(answer.helped?'Correct with Help Me':'Correct after retry'):state==='skipped'?'Skipped':answer?'In progress':'Not tried';
  return {state,label};
}
