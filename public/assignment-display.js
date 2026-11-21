// Creation times and days remaining are presented using the browser's local calendar.
export function assignmentDateLabel(createdAt, expiresAt, now = new Date()) {
  const created=new Date(createdAt*1000), expires=new Date(expiresAt*1000);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-AU',{hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(created).map(part=>[part.type,part.value]));
  const time=`${parts.hour}:${parts.minute} ${parts.dayPeriod.toUpperCase()}`;
  const date=created.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
  const calendarDay=value=>Date.UTC(value.getFullYear(),value.getMonth(),value.getDate());
  const days=Math.max(0,Math.round((calendarDay(expires)-calendarDay(now))/86400000));
  const expiry=expires<=now?'expired':days===0?'expires today':`expires in ${days} ${days===1?'day':'days'}`;
  return `${time} ${date} (${expiry})`;
}
