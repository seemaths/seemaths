"""Local bridge test only. Never ship this as the maths player."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = b'''<!doctype html><html lang="en"><meta charset="utf-8"><title>Player integration test fixture</title>
<body><h1>Player integration test fixture</h1><p>Three synthetic answers exercise the actual bridge module.</p>
<button id="first">Check first answer</button><button id="second">Check second answer</button><button id="finish">Finish exercise</button>
<p id="state">Ready</p><script type="module" src="/fixture.js"></script></body></html>'''
SCRIPT = b'''
import {assignmentBridge} from '/bridge.js';
const bridge=assignmentBridge({allowedPortalOrigins:['http://127.0.0.1:4182']});
const attempt={id:crypto.randomUUID(),recipe:{count:3,mode:'practice'},state:{answers:[]}};
bridge.report(attempt);
document.querySelector('#first').onclick=()=>{attempt.state.answers[0]={value:'2',checked:true,correct:true};bridge.report(attempt);document.querySelector('#state').textContent='First answer sent';};
document.querySelector('#second').onclick=()=>{attempt.state.answers[1]={value:'3',checked:true,correct:false};bridge.report(attempt);document.querySelector('#state').textContent='Second answer sent';};
document.querySelector('#finish').onclick=()=>{attempt.state.answers[2]={value:'4',checked:true,correct:true};bridge.report(attempt);document.querySelector('#state').textContent='Completed';};
'''

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path=self.path.split('?')[0]
        body,kind=(SCRIPT,'text/javascript') if path=='/fixture.js' else ((ROOT/'integration/quode-assignment-bridge.js').read_bytes(),'text/javascript') if path=='/bridge.js' else (HTML,'text/html')
        self.send_response(200);self.send_header('Content-Type',kind);self.end_headers();self.wfile.write(body)
    def log_message(self,*args):
        pass

if __name__=='__main__':
    print('Bridge fixture: http://127.0.0.1:4181',flush=True)
    HTTPServer(('127.0.0.1',4181),Handler).serve_forever()
