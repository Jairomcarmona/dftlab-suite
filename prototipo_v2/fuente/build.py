import json,sys
SP="/tmp/claude-0/-home-claude/d87ddaff-ef85-5955-9e4b-2e2775a6c709/scratchpad"
D=open('/opt/run/si/si_proto.json').read()
W=open('/opt/run/si/wf.json').read()
X=open('/opt/run/app2/px.json').read() if __import__('os').path.exists('/opt/run/app2/px.json') else '{}'
head=open('head.html').read(); body=open('body.html').read(); app=open('app.js').read()
px=open('px.js').read() if __import__('os').path.exists('px.js') else ''
cdn='<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>\n'
loc='<script src="three.js"></script>\n<script src="oc.js"></script>\n'
def page(scripts):
    return head+body+'<script id="data" type="application/json">'+D+'</script>\n<script id="wfdata" type="application/json">'+W+'</script>\n<script id="pxdata" type="application/json">'+X+'</script>\n'+scripts+'<script>\n'+app+'\n</script>\n'+('<script>\n'+px+'\n</script>\n' if px else '')
open(SP+'/dft_lab_si.html','w').write(page(cdn))
open(SP+'/shot/page.html','w').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>\n'+page(loc)+'</body></html>')
import os; print(os.path.getsize(SP+'/dft_lab_si.html')/1e6,'MB')
