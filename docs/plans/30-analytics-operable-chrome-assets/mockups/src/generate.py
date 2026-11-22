"""Regenerate standalone synthetic HTML references. Run from this directory.
These files are design references, never product fixtures or API evidence.
"""
from pathlib import Path
import json, html
ROOT=Path(__file__).resolve().parent
# key, title, type, caption. Endpoint/axis contracts live in DESIGN.md.
CHARTS={
'activity':('Recent activity','table','Each row is a session start, artifact version, brief execution or rejection; these observations are not a count of all events.'),
'metrics':('Window totals','metrics','These totals describe the selected period; each label names its own unit and the values must not be added together.'),
'movers':('Spend by harness and model','bars','Each bar shows priced spend for a harness or model; longer bars mean more dollars spent in the selected period.'),
'calendar':('Daily spend','heat','Each square shows priced spend on one day; use the labelled colour scale to compare dollars spent.'),
'coverage':('Data coverage','table','These rows show the latest retained records and missing prices or scores; missing data is not zero activity.'),
'columns':('Spend over time','columns','Each bar shows priced model spend in one time bucket; taller bars mean more dollars spent.'),
'lines':('Spend by model over time','lines','Each line shows a model’s priced spend over time; higher points mean more dollars spent in that bucket.'),
'multiples':('One spend chart per model','lines','Each small chart shows one model’s priced spend over time on the same scale; compare heights across charts.'),
'rhythm':('When hook events happen','heat','Each square counts hook events for a weekday and hour in the selected timezone; use the labelled colour scale to compare event counts.'),
'rank':('Spend by model','bars','Each bar shows a model’s total priced spend; models are ordered from most to least dollars spent.'),
'costmap':('Spend by harness and model','treemap','Each rectangle shows priced spend for a model within a harness; larger rectangles mean more dollars spent.'),
'ranges':('Session cost by repository','ranges','Each row shows the spread of session costs for a repository; the box covers the middle half and the line marks the median.'),
'hist':('Model call costs by harness','columns','Each bar counts model calls in a cost range for a harness; taller bars mean more calls in that range.'),
'ecdf':('Share of sessions below each cost','ecdf','Each line shows the percentage of sessions at or below a cost; read up from a dollar amount to find that percentage.'),
'scores':('Design scores by harness','ranges','Each row shows design clarity scores for a harness, counting each content version once; the box covers the middle half and the line marks the median.'),
'scoretrend':('Design clarity over time','lines','Each line shows design clarity scores over time for one session model; the middle line is the median and the outer lines bound the middle half.'),
'strips':('Artifact clarity by kind','scatter','Each dot is a file’s latest clarity score, grouped by document kind; dots farther right have higher scores.'),
'bands':('Artifact score bands','bars','Each bar counts files of one document kind by clarity band; unscored files are shown separately from scored files.'),
'mix':('Hook events by tool category','bars','Each bar counts hook events for a tool category, split by harness; longer segments mean more events.'),
'toolsmap':('Hook events by harness and tool','treemap','Each rectangle counts hook events for a tool within a harness; larger rectangles mean more events.'),
'toolsrank':('Most used tools','bars','Each bar counts hook events for a tool; tools are ordered from most to least events.'),
'shapes':('Execution completion by plan','bars','Each bar counts a plan’s complete, unreported and started executions; completion describes recorded steps, not whether the work succeeded.'),
'planline':('Plan activity over time','lanes','Each marker shows a recorded plan event at its event time; rows separate plans and do not imply continuous work between markers.'),
'planrank':('Associated spend by plan','bars','Each bar shows spend from sessions associated with a plan; shared sessions can contribute to more than one plan, so do not add the bars.'),
'sessionxy':('Session spend and commits','scatter','Each dot is a session, with priced spend across and commit count up; larger dots mean more calls without prices.'),
'artifactxy':('Writing-session spend and clarity','scatter','Each dot is a file, with its writing session’s spend across and its clarity score up; this association does not prove that spending improves quality.'),
'planxy':('Plan spend and artifact count','scatter','Each dot is a plan, with associated session spend across and file count up; plans can share the same session costs.'),
'dayxy':('Daily spend and commits','scatter','Each dot is a time bucket, with priced spend across and commits up; buckets without prices remain marked as incomplete.'),
'compranges':('Call cost spread: current and previous','ranges','Each pair of rows compares call costs for a model in the selected and previous equal-length periods; compare medians and the middle-half boxes.'),
'comphist':('Call cost ranges: current and previous','columns','Each bar counts calls in a cost range for the selected or previous equal-length period; compare bar heights within the same range.'),
'compecdf':('Call cost percentages: current and previous','ecdf','Each line shows the percentage of calls at or below a cost in one period; a higher line means more calls fall below that cost.'),
'complines':('Spend: current and previous','lines','Each line shows priced spend in the selected or previous equal-length period; matching elapsed positions compare the same point within each period.'),
'slope':('Model spend change','lines','Each segment joins a model’s previous and selected-period spend; an upward segment means that model cost more in the selected period.'),
'sessionlanes':('Session events over time','lanes','Each marker shows a retained event in this session matching the filters; gaps between markers do not prove the session was idle.'),
'artifactscore':('Clarity across file versions','lines','Each point shows this file version’s clarity score at its observation time; higher points mean a higher score under the selected scorer.'),
'footprint':('Retained storage','bars','Each bar shows retained bytes for one storage category in this tenant; longer bars mean more space used.')}
BOARDS={
'pulse':['metrics','activity','movers','calendar','coverage'],
 'trends':['columns','lines','multiples','calendar','rhythm'],
 'cost':['columns','rank','costmap','ranges','hist','ecdf'],
 'quality':['scores','scoretrend','strips','bands'],
 'tools':['mix','toolsmap','toolsrank','rhythm'],
 'workflow':['shapes','planline','planrank','planxy','activity'],
 'compare':['compranges','comphist','compecdf','complines','slope'],
 'scatter':['sessionxy','artifactxy','planxy','dayxy']}
SCREENS=[('start','Start','/'),*[(k,k.title(),'/b/'+k) for k in BOARDS],('plans','Plans','/plans'),('plan-detail','Plan: analytics-ui-rework','/plans/codyhamilton%2Fyakka/29-analytics-ui-rework'),('sessions','Sessions','/sessions'),('session-detail','Session: sess-c81e','/sessions/sess-c81e'),('ledger','Event ledger','/ledger'),('artifact','Artifact: DESIGN.md','/artifact?repo_id=codyhamilton%2Fyakka&path=docs%2Fplans%2F30-analytics-operable-chrome%2FDESIGN.md'),('ops','Operations','/ops'),('profile','Account, tenants & tokens','/profile'),('settings','Connection settings','/settings'),('lifecycle','Tenant lifecycle','https://api.yakka.build/profile/lifecycle'),('login','Sign in','/login'),('callback','Completing sign in','/oauth/callback'),('device','Device approval','/device'),('notfound','Page not found','/missing')]
NAV=[('Start','start'),*[(k.title(),k) for k in BOARDS],('Plans','plans'),('Sessions','sessions'),('Ledger','ledger'),('Operations','ops')]
ESC=html.escape

def table(cols,rows):
 return '<table><thead><tr>'+''.join('<th>'+c+'</th>' for c in cols)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+str(v)+'</td>' for v in row)+'</tr>' for row in rows)+'</tbody></table>'

def plot(kind,key):
 if kind=='table':
  if key=='coverage':return table(['Source','Latest retained','Missing','Unit'],[['Model usage','21 Nov 20:21','12','unpriced calls'],['Artifacts','21 Nov 20:20','—','score count unavailable'],['Hooks','21 Nov 20:21','—','events']])
  return table(['Time (AEST)','Type','Repository / record'],[['20:21:08','Artifact version','yakka / DESIGN.md'],['20:20:41','Brief execution','yakka / 30-operable-chrome'],['20:18:12','Session start','sess-c81e']])
 if kind=='metrics':return '<div class="metrics">'+''.join(f'<div><span>{k}</span><strong>{v}</strong></div>' for k,v in [('Priced spend','$48.32'),('Model calls','1,206'),('Hook events','8,124'),('Artifact versions','188'),('Commits','47'),('Sessions','86'),('Unpriced calls','12')])+'</div>'
 # Fixed samples show the specified axes, units and group meaning for each chart.
 score=key in ['scores','scoretrend','strips','artifactscore']
 cumulative=kind=='ecdf';compare=key.startswith('comp')
 yunit='Score (0–1)' if key in ['scoretrend','artifactscore','artifactxy'] else 'Calls' if key in ['hist','comphist'] else 'Share (%)' if cumulative else 'Commits' if key in ['sessionxy','planxy','dayxy'] else 'USD'
 xunit='Cost (USD)' if cumulative or key in ['ranges','hist','compranges','comphist'] else 'Score (0–1)' if key in ['scores','strips'] else 'Associated spend (USD)' if key=='planxy' else 'Spend (USD)' if kind=='scatter' else 'Event time (AEST)'
 groups=['Claude','Codex','Cursor']
 if key=='ranges':groups=['yakka','hooks','client']
 if key=='compranges':groups=['Sonnet current','Sonnet previous','GPT current','GPT previous']
 if key in ['mix']:groups=['Read','Write','Shell']
 if key in ['toolsrank','toolsmap']:groups=['ReadFile','ApplyPatch','Shell']
 if key in ['shapes','planrank']:groups=['29-ui-rework','30-operable','28-reviews']
 if key=='bands':groups=['Design','Brief','Report']
 if key=='strips':groups=['Design','Brief','Report']
 if key=='footprint':groups=['Ledger','Blobs','Archive']
 svg='<svg viewBox="0 0 650 112" role="img" aria-label="Synthetic chart preview">'
 if kind=='heat':
  cols=24 if key=='rhythm' else 7
  step=23 if key=='rhythm' else 78
  for y in range(5):
   for x in range(cols):svg+=f'<rect x="{45+x*step}" y="{8+y*17}" width="{step-3}" height="14" fill="var(--yk-seq-{1+(x*3+y*7)%5})"/>'
  svg+='<text x="45" y="109">'+('Mon → Fri · 00:00 → 23:00 AEST · hook events' if key=='rhythm' else 'Mon → Sun · rows are weeks · USD/day')+'</text>'
 elif kind=='treemap':
  labels=['Claude / Sonnet · $21.20','Codex / GPT · $18.40','Cursor / Luna · $6.72','Other · $2.00'] if key=='costmap' else ['Claude / ReadFile · 4,210','Codex / Shell · 2,180','Cursor / ApplyPatch · 1,110','Other · 624']
  for (x,y,w,h,c),t in zip([(32,2,290,60,1),(326,2,286,60,2),(32,66,270,30,3),(306,66,306,30,4)],labels):svg+=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="var(--yk-cat-{c})" opacity=".6"/><text x="{x+5}" y="{y+20}">{t}</text>'
 elif kind=='bars':
  unit='Files' if key=='bands' else 'Executions' if key=='shapes' else 'Hook events' if key in ['mix','toolsrank'] else 'MiB retained' if key=='footprint' else 'USD'
  for i,(t,v) in enumerate(zip(groups,[440,340,220])):
   svg+=f'<text x="12" y="{19+i*25}">{t}</text>'
   if key in ['bands','shapes','mix']:
    off=130
    for j,part in enumerate([.65,.23,.12]):
     fill=f'var(--yk-status-{["good","warn","info"][j]})' if key=='shapes' else f'var(--yk-cat-{j+1})'
     svg+=f'<rect x="{off}" y="{5+i*25}" width="{v*part}" height="16" fill="{fill}"/>';off+=v*part
   else:svg+=f'<rect x="130" y="{5+i*25}" width="{v}" height="16" fill="var(--yk-cat-{i+1})"/>'
  svg+=f'<path d="M130 1V87H615" fill="none" stroke="var(--yk-chart-grid)"/><text x="130" y="108">0</text><text x="500" y="108">{unit} →</text>'
 elif kind=='ranges':
  for i,t in enumerate(groups):
   yy=10+i*(18 if compare else 25);col=1+(i//2 if compare else i)
   svg+=f'<text x="12" y="{yy+5}">{t}</text><path d="M190 {yy}H490" stroke="var(--yk-cat-{col})"/><rect x="{230+i*20}" y="{yy-7}" width="110" height="14" fill="var(--yk-cat-{col})" opacity="{.25 if compare and i%2 else .65}"/><path d="M{270+i*20} {yy-8}V{yy+8}" stroke="var(--yk-chart-text)"/>'
  svg+=f'<text x="190" y="108">0</text><text x="360" y="108">{xunit} →</text><text x="580" y="108">{1 if score else 10}</text>'
 elif kind=='lanes':
  for i,t in enumerate(['Versions','Executions','Session starts'] if key=='sessionlanes' else ['Plan 29','Plan 30','Plan 28']):
   svg+=f'<text x="12" y="{20+i*25}">{t}</text><path d="M130 {16+i*25}H610" stroke="var(--yk-chart-grid)"/>'
   for j in range(5):svg+=f'<circle cx="{160+j*80+i*17}" cy="{16+i*25}" r="4" fill="var(--yk-cat-{i+1})"/>'
  svg+='<text x="130" y="108">19:00</text><text x="335" y="108">Event time (AEST) →</text><text x="565" y="108">20:24</text>'
 elif key=='multiples':
  for g,name in enumerate(['Sonnet','GPT','Luna']):
   off=10+g*215
   svg+=f'<text x="{off+5}" y="12">{name} · USD</text><path d="M{off+10} 20V88H{off+200}" stroke="var(--yk-chart-grid)" fill="none"/>'
   pts=' '.join(f'{off+15+j*25},{28+(j*13+g*7)%49}' for j in range(8))
   svg+=f'<polyline points="{pts}" fill="none" stroke="var(--yk-cat-{g+1})" stroke-width="2"/><text x="{off+5}" y="108">Selected period →</text>'
 elif key=='slope':
  for i,(left,right) in enumerate([(75,25),(40,65),(63,44)]):svg+=f'<path d="M160 {left}L480 {right}" stroke="var(--yk-cat-{i+1})" stroke-width="2"/><circle cx="160" cy="{left}" r="3" fill="var(--yk-cat-{i+1})"/><circle cx="480" cy="{right}" r="3" fill="var(--yk-cat-{i+1})"/>'
  svg+='<text x="10" y="10">USD</text><text x="135" y="108">Previous</text><text x="460" y="108">Current</text>'
 else:
  top='1.0' if score or key=='artifactxy' else '100' if cumulative else '10' if key in ['sessionxy','dayxy'] else '30' if key=='planxy' else '40'
  svg+=f'<path d="M48 4V88H625 M48 46H625" fill="none" stroke="var(--yk-chart-grid)"/><text x="5" y="13">{top}</text><text x="20" y="90">0</text><text x="55" y="12">{yunit} ↑</text>'
  if key=='strips':
   for g,t in enumerate(groups):
    svg+=f'<text x="10" y="{22+g*24}">{t}</text>'
    for j in range(7):svg+=f'<circle cx="{200+j*49+g*7}" cy="{18+g*24}" r="3" fill="var(--yk-cat-{g+1})"/>'
  elif kind=='columns':
   for i in range(10):
    x=65+i*54;y=22+(i*13)%52
    svg+=f'<rect x="{x}" y="{y}" width="{17 if compare else 28}" height="{88-y}" fill="var(--yk-cat-{1+i%3})"/>'
    if compare:svg+=f'<rect x="{x+20}" y="{y+7}" width="17" height="{81-y}" fill="none" stroke="var(--yk-cat-{1+i%3})"/>'
  elif kind=='scatter':
   for i in range(18):svg+=f'<circle cx="{75+i*29}" cy="{18+(i*17)%62}" r="{3+i%4 if key=="sessionxy" else 4}" fill="var(--yk-cat-{1+i%3})"/>'
  elif kind in ['lines','ecdf']:
   for c in range(1,4):
    pts=' '.join(f'{65+i*48},{(86-i*7-c*3) if cumulative else (20+(i*17+c*11)%60)}' for i in range(12))
    svg+=f'<polyline points="{pts}" fill="none" stroke="var(--yk-cat-{c})" stroke-width="2" {"stroke-dasharray=5,3" if compare and c==2 else ""}/>'
  svg+=f'<text x="55" y="108">{xunit} →</text>'
 return svg+'</svg>'

def legend_for(key):
 return {'shapes':'● Complete   ● Unreported   ● Started','bands':'● Low band   ● Middle band   ● High band   ○ Unscored','ranges':'● yakka   ● hooks   ● client','compranges':'— Current   - - Previous · grouped by model','comphist':'■ Current   □ Previous · grouped by model','compecdf':'— Current   - - Previous · grouped by model','complines':'— Current   - - Previous · grouped by model','slope':'● Sonnet   ● GPT   ● Luna','strips':'● Design   ● Brief   ● Report','rank':'● Sonnet   ● GPT   ● Luna','lines':'● Sonnet   ● GPT   ● Luna','columns':'● Sonnet   ● GPT   ● Luna','multiples':'Sonnet | GPT | Luna · shared scale','scoretrend':'— Median · - - Middle-half bounds · session model colour','scores':'● Claude   ● Codex   ● Cursor · baseline shaded','ecdf':'● Sonnet   ● GPT   ● Luna · binned approximation','planrank':'● Plan 29   ● Plan 30   ● Plan 28','planxy':'● yakka   ● hooks   ● client','footprint':'Ledger   Blobs   Archive · all retained tenant storage','calendar':'0 USD → $8.20 · daily spend scale','rhythm':'0 events → 180 events · count scale'}.get(key,'' if key in ['metrics','activity','coverage'] else '● Claude   ● Codex   ● Cursor')

def panel_controls(key):
 def select(label,options,default=None):
  return '<label>'+label+' <select>'+''.join('<option'+(' selected' if o==default else '')+'>'+o+'</option>' for o in options)+'</select></label>'
 parts=[]
 if key in ['columns','lines','multiples','rank','calendar','complines','slope','costmap']:
  parts.append(select('Measure',['Priced spend','Model calls','Hook events','Commits'],'Priced spend'))
  if key!='calendar':parts.append(select('Group by',['Model','Harness','Repository'],'Model'))
  if key=='columns':parts.append(select('Chart',['Columns','Lines','Share'],'Columns'))
 if key in ['ranges','hist','ecdf','compranges','comphist','compecdf']:
  parts=[select('Measure',['Priced spend','Input tokens','Output tokens'],'Priced spend'),select('Grain',['Model call','Session'],'Session' if key in ['ranges','ecdf'] else 'Model call'),select('Group by',['Model','Harness','Session repository'],'Session repository' if key=='ranges' else 'Harness' if key=='hist' else 'Model')]
 if key in ['scores','scoretrend','strips','bands','artifactscore','artifactxy']:
  parts.extend([select('Check',['Clarity','Completeness'],'Clarity'),select('Scorer',['clarity-v2','clarity-v1'],'clarity-v2')])
  if key in ['scores','scoretrend']:parts.append(select('Group by',['Harness','Session model','Repository'],'Harness' if key=='scores' else 'Session model'))
 if key in ['sessionxy','artifactxy','planxy','dayxy']:
  x='Writing-session spend' if key=='artifactxy' else 'Associated spend' if key=='planxy' else 'Priced spend'
  y='Clarity score' if key=='artifactxy' else 'Files' if key=='planxy' else 'Commits'
  parts.extend([select('X axis',[x,y],x),select('Y axis',[y,x],y),select('Size',['None','Unpriced calls'],'Unpriced calls' if key=='sessionxy' else 'None'),select('Colour',['Session model','Repository','None'],'Repository' if key=='planxy' else 'None' if key=='dayxy' else 'Session model')])
 if key=='shapes':parts.append(select('Group by',['Plan'],'Plan'))
 if key=='planline':parts.append(select('Plan',['yakka / 29-ui-rework','yakka / 30-operable'],'yakka / 29-ui-rework'))
 return '<div class="panel-controls">'+''.join(parts)+'</div>' if parts else ''

def panel(key,wide=False):
 t,k,c=CHARTS[key]
 return f'<section class="panel {"wide" if wide else ""}"><header><h2>{t}</h2><button class="table-toggle">Show table</button></header><p class="caption">{c}</p>{panel_controls(key)}<div class="plot">{plot(k,key)}</div>{"<p>3 observations displayed of 16 matching observations</p>" if key=="activity" else ""}<div class="legend">{legend_for(key)} <span>Selected tenant · synthetic reference</span></div></section>'

def contents(s):
 if s in BOARDS:return ('<div class="board-controls"><label>Comparison <select><option>Previous equal period</option><option>No comparison</option><option disabled>Saved cohorts</option></select></label></div>' if s=='compare' else '')+'<div class="grid">'+''.join(panel(x,(s=='pulse' and x=='metrics') or (i==len(BOARDS[s])-1 and len(BOARDS[s])%2==1 and s!='pulse')) for i,x in enumerate(BOARDS[s]))+'</div>'
 if s=='start':return '<section class="panel"><h2>Choose a question</h2>'+table(['Area','Open a view','What it answers'],[[k.title(),f'<a href="{k}.html">{CHARTS[v[0]][0]}</a>',CHARTS[v[0]][2]] for k,v in BOARDS.items()])+'</section><section class="panel"><h2>Saved boards</h2><label>Board name <input value="Weekly review"></label> <button>Save current view</button><p>No saved boards yet.</p></section>'
 if s=='plans':return '<section class="panel"><h2>Plans</h2><label>Sort <select><option>Associated cost</option><option>Last observed</option><option>Artifacts</option></select></label> <select aria-label="Direction"><option>Descending</option><option>Ascending</option></select>'+table(['Plan','Cost USD','Sessions','Shared','Files','Versions','Complete / unreported / started','Complete %','Design score','Last observed','Open'],[[f'{n}-'+t,f'${v}',s,2,18,42,'12 / 2 / 1','80%','0.78','21 Nov 20:21','<a href="plan-detail.html">Open</a>'] for n,t,v,s in [(29,'analytics-ui-rework','28.45',8),(30,'analytics-operable-chrome','12.08',3),(28,'review-service','7.79',5)]])+'<button class="more">Load more plans</button></section>'
 if s=='plan-detail':return '<div class="identity">codyhamilton/yakka · 29-analytics-ui-rework · Associated cost $28.45 · shared session cost may overlap other plans</div>'+panel('planline')+''.join('<section class="panel"><h2>'+title+'</h2>'+table(cols,rows)+'</section>' for title,cols,rows in [('Artifacts',['Kind','Path','Version','Score / scorer','Content','Verdict','Writing cost','Open'],[['Design','DESIGN.md','a1b2c3','0.78 / clarity-v2','Stored','Passed','$8.20','<a href="artifact.html">Open</a>']]),('Executions',['Shape','Brief path','Time','Session cost','Brief / report scores','Session'],[['Complete','briefs/01.md','20:10','$3.12','0.79 / 0.82','<a href="session-detail.html">Open</a>']]),('Associated sessions',['Conversation','Last observed','Cost','Unpriced'],[['sess-c81e','20:21','$8.20','0']]),('Plan events',['Time','Type','Event','Path','Conversation'],[['20:21','Artifact version','design observed','DESIGN.md','sess-c81e']])])
 if s=='sessions':return '<section class="panel"><h2>Sessions</h2><label>Sort <select><option>Cost</option><option>Calls</option><option>Duration</option></select></label> <select aria-label="Direction"><option>Descending</option><option>Ascending</option></select>'+table(['Select','Session','Harness','Model','Repository','Cost USD','Calls','Unpriced','Hooks','Commits','Versions','Span (s)','Open'],[['<input type="checkbox">',f'sess-{x}','Codex','gpt-6.2','yakka',f'${v}',145,0,842,3,8,1240,'<a href="session-detail.html">Open</a>'] for x,v in [('c81e','8.20'),('bc23','6.40'),('a177','4.12')]])+'<button class="more">Load more sessions</button></section>'
 if s=='session-detail':return '<div class="identity">sess-c81e · Codex · gpt-6.2 · window spend $8.20 · whole-run spend $9.18</div>'+panel('sessionlanes')+'<section class="panel"><h2>Session records</h2>'+table(['Time','Event','Repository','Path','Cost USD'],[['20:21:08','Artifact version','yakka','DESIGN.md','—'],['20:20:41','Model call','yakka','—','$0.18'],['20:20:18','Hook event','—','—','—']])+'</section>'
 if s=='ledger':return '<section class="panel"><h2>Retained events and rejections</h2><p>100 rows displayed of 8,410 matching records · 8,406 matching events · 4 matching rejections · 12,480 all-history events</p>'+table(['Time (AEST)','Type','Repository','Plan','Kind','Path / event','Conversation','Stage','Cost USD'],[[f'20:{23-i//5:02d}:{59-(i%5)*11:02d}',t,'yakka','30-analytics-operable-chrome',k,p,'sess-c81e','—',v] for i,(t,k,p,v) in enumerate([('artifact_version','design','DESIGN.md','—'),('usage','','model call','$0.18'),('hook_event','','PostToolBatch','—'),('commit','','4bd7192','—'),('session_action','','session stopped','—')]*20)])+'<button class="more">Load more events</button></section>'
 if s=='artifact':return '<div class="identity">codyhamilton/yakka · docs/plans/30-analytics-operable-chrome/DESIGN.md</div><section class="panel"><h2>Versions</h2><label>Version <select><option>a1b2c3 · 21 Nov 20:21</option><option>f4e5d6 · 21 Nov 19:08</option></select></label> <label>Compare from <select><option>f4e5d6</option><option>a1b2c3</option></select></label> <label>Compare to <select><option>a1b2c3</option><option>f4e5d6</option></select></label> <button>Show diff</button>'+table(['Observed','Hash','Kind','Score / scorer','Content','Verdict','Writing session'],[['21 Nov 20:21','a1b2c3','Design','0.78 / clarity-v2','Stored','Passed','sess-c81e'],['21 Nov 19:08','f4e5d6','Design','0.72 / clarity-v2','Stored','Passed','sess-bc23']])+'</section>'+panel('artifactscore')+'<section class="panel"><h2>Version text — plain text</h2><pre># Analytics operable chrome\n\n## Intent\nMake the analytics console operable with real filters and explicit counts.</pre></section>'
 if s=='ops':return '<section class="panel"><h2>Tenant health</h2>'+table(['Measure','Count','Meaning'],[['Unpriced calls','12','Calls with no usable price'],['Unscored design content versions (all history)','8','Distinct content versions; all retained data in tenant'],['Rejected submissions','4','Two precheck and two screen rejections'],['Sessions without repository attribution (all history)','6','All retained data in selected tenant; time and repository filters do not apply']])+'</section>'+panel('footprint')+'<section class="panel"><h2>Recent retained records</h2>'+table(['Time','Type','Path/event','Stage'],[['20:14','Rejection','briefs/02.md','Precheck'],['20:10','Hook event','PostToolBatch','—']])+'</section>'
 if s=='profile':return '<section class="panel" id="membership"><span id="tenants"></span><h2>Tenants & membership</h2><p>Signed in as codyhamilton · memberships below are tenants you own.</p><form><label>New tenant <input name="name" placeholder="Tenant name" maxlength="64" required></label> <button>Create tenant</button></form>'+table(['Tenant name','Immutable ID','Your access','Lifecycle state','Generation','Actions'],[['Personal','tenant-personal','Owner','Active','1','<button>Use tenant</button> <a href="lifecycle.html">Reset or delete…</a>'],['Yakka lab','tenant-lab','Owner','Active','1','<button>Use tenant</button> <a href="lifecycle.html">Reset or delete…</a>']])+'</section><section class="panel" id="tokens"><h2>Tokens — selected tenant</h2><form><label>Token name <input value="token"></label> <label>Scope <select><option>Read</option><option>Read and write</option></select></label> <label>Lifetime <select><option>1 day</option><option>1 week</option><option>1 month</option><option selected>3 months</option><option>6 months</option><option>1 year</option></select></label> <button>Create token</button></form><p>A newly issued token appears once; existing token secrets are never listed.</p>'+table(['Name','Tenant','Scope','Created','Expires','State','Action'],[['Laptop collector','Personal','Read and write','1 Nov 2026','1 Feb 2027','Active','<button>Revoke</button>'],['Read dashboard','Personal','Read','12 Nov 2026','12 Dec 2026','Active','<button>Revoke</button>']])+'</section>'
 if s=='settings':return '<section class="panel"><h2>Connection</h2><form class="stack"><label>API base URL <input placeholder="https://api.yakka.build"></label><label>Bearer token <input type="password" autocomplete="off" value=""></label><div><button>Save settings</button> <button type="reset">Clear settings</button> <button type="button">Sign out</button></div></form></section>'
 if s=='lifecycle':return '<section class="panel"><h2>Owner tenant lifecycle</h2><p>Only the human owner may reset or delete a tenant. This page runs at the API origin.</p>'+table(['Tenant','Immutable ID','State','Actions'],[['Personal','tenant-personal','Active','<button>Reset tenant</button> <button>Delete tenant</button>'],['Yakka lab','tenant-lab','Active','<button>Reset tenant</button> <button>Delete tenant</button>']])+'</section><section class="panel"><h2>Confirmation appearance (shown after an action)</h2><p>Reset removes retained tenant data and revokes its tokens. The tenant identity remains.</p><label>Type the immutable tenant id to confirm <input placeholder="tenant-personal"></label> <button>Cancel</button> <button disabled>Confirm</button></section>'
 if s=='device':return '<section class="panel"><h2>Check this code matches your terminal</h2><form><label>User code <input value="ABCD-EFGH"></label> <button>Continue</button></form><p>Request from workstation · synthetic request</p><form><label>Scope <select><option>Choose access</option><option>Read</option><option>Read and write</option></select></label> <label>Lifetime <select><option>1 day</option><option>1 week</option><option>1 month</option><option selected>3 months</option><option>6 months</option><option>1 year</option></select></label> <label>Token name <input value=""></label> <button disabled>Approve</button> <button type="button">Deny</button></form></section>'
 if s=='login':return '<section class="panel"><h2>Sign in to your Yakka account to continue</h2><a href="#" class="button">Continue with GitHub</a><p>Tenant selection becomes available after sign in.</p></section>'
 if s=='callback':return '<section class="panel"><h2>Completing sign in…</h2><p>Checking the sign-in response before returning to your requested page.</p><a href="login.html">Try sign in again</a></section>'
 return '<section class="panel"><h2>No page matches this address</h2><a href="start.html">Open Start</a> · <a href="pulse.html">Open Pulse</a></section>'

for key,title,route in SCREENS:
 analytics=key not in ['profile','settings','lifecycle','login','callback','device','notfound']
 nav=''.join(f'<a href="{k}.html" {"aria-current=page" if k==key else ""}>{label}</a>' for label,k in NAV)
 account='<a href="profile.html#tokens">Tokens</a><a href="profile.html#membership">Tenants</a><a href="profile.html#membership">Membership</a><a href="settings.html">Settings</a><a href="device.html">Device approval</a>'
 filters='''<form id="filters"><label>Window <select name="win"><option value="1d">24 hours</option><option value="7d">7 days</option><option value="30d" selected>30 days</option><option value="90d">90 days</option><option value="all">All history</option><option value="custom">Custom…</option></select></label><label>Repository <select name="repo_id"><option value="">All repositories</option><option value="codyhamilton/yakka">codyhamilton/yakka</option><option value="codyhamilton/hooks">codyhamilton/hooks</option></select></label><label>Kind <select name="kind"><option value="">All kinds</option><option value="design">Design</option><option value="brief">Brief</option><option value="report">Report</option></select></label><span class="custom" hidden><label>From <input name="from" type="datetime-local"></label> <label>To <input name="to" type="datetime-local"></label></span><button type="submit" disabled>Apply filters</button><button type="button" id="reset">Reset filters</button><button type="button" id="all">All history</button><label class="tz">Timezone <select name="tz"><option>Australia/Brisbane</option><option>UTC</option></select></label></form><div class="status-row"><div id="counts" role="status">Events matching filters: 8,406 · Rejections: 4 · All retained events in tenant: 12,480 · Counts checked 20:24 AEST</div><button type="button" id="refresh">Refresh</button><details><summary>Advanced scope</summary><p>No advanced filters applied.</p></details></div>''' if analytics else '<p class="account-note">Account controls use the selected tenant. Time, repository and kind filters apply on analytics pages.</p>'
 doc=f'''<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{title} — Plan 30 reference</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="mockup.css"><script defer src="mockup.js"></script></head><body data-screen="{key}"><header class="top"><a class="brand" href="start.html">Yakka <span>Analytics</span></a><label>Tenant <select id="tenant" {"disabled" if key in ['login','callback'] else ""}><option value="tenant-personal">Personal · tenant-personal</option><option value="tenant-lab">Yakka lab · tenant-lab</option></select></label><button id="theme">Theme</button><span class="reference">DESIGN REFERENCE · synthetic data</span></header><nav aria-label="Analytics">{nav}</nav><nav aria-label="Account">{account}</nav><main><div class="page-title"><h1>{title}</h1><code>{ESC(route)}</code></div>{filters}{contents(key)}</main><footer>Plan 30 · written specification is authoritative <span id="notice">No production requests · local synthetic preview</span></footer></body></html>'''
 (ROOT/(key+'.html')).write_text(doc)
(ROOT/'screens.json').write_text(json.dumps([{'key':k,'title':t,'route':r} for k,t,r in SCREENS],indent=2)+'\n')
