const sharpSchoolEndpoint = 'https://frankford.hpedsb.on.ca/Common/controls/WorkspaceCalendar/ws/WorkspaceCalendarWS.asmx/Modern_Events';
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const requestedYear = Number(new URL(request.url).searchParams.get('year'));
  const year = Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= 2100 ? requestedYear : new Date().getFullYear();
  const payload = {
    portletInstanceId: 615636,
    primaryCalendarId: 10527177,
    calendarIds: [10527177],
    localFromDate: `${year}-01-01 00:00:00`,
    localToDate: `${year}-12-31 23:59:59`,
    filterFieldValue: '',
    searchText: '',
    categoryFieldValue: '',
    filterOptions: [],
  };

  try {
    const response = await fetch(sharpSchoolEndpoint, { method: 'POST', headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`SharpSchool returned ${response.status}`);
    const result = await response.json(); const calendar = result.d ?? result;
    const events = Array.isArray(calendar.events) ? calendar.events.map((event: { name: string; localStartDate: string; location?: string }) => ({ name: event.name, event_date: event.localStartDate.slice(0, 10), location: event.location ?? '', event_type: 'school', source: 'school' })) : [];
    return Response.json(events, { headers: corsHeaders });
  } catch (error) {
    console.error('Unable to load school calendar:', error);
    return Response.json({ error: 'Unable to load the school calendar.' }, { status: 502, headers: corsHeaders });
  }
});