const $ = (id) => document.getElementById(id);

const templates = {
  notepad: {
    name: "notepad-test",
    actions: [
      {type:"launch", executable:"notepad.exe"},
      {type:"wait", seconds:1.5},
      {type:"type", window_title_re:".*(Notepad|메모장).*", control_type:"Document", text:"Stargate Windows RPA test"},
      {type:"screenshot", screenshot_name:"notepad-dashboard-test.png"}
    ]
  },
  calculator: {
    name: "calculator-test",
    actions: [
      {type:"launch", executable:"calc.exe"},
      {type:"wait", seconds:1.5},
      {type:"focus", window_title_re:".*(Calculator|계산기).*"},
      {type:"hotkey", window_title_re:".*(Calculator|계산기).*", keys:["2"]},
      {type:"hotkey", window_title_re:".*(Calculator|계산기).*", keys:["+"]},
      {type:"hotkey", window_title_re:".*(Calculator|계산기).*", keys:["3"]},
      {type:"hotkey", window_title_re:".*(Calculator|계산기).*", keys:["enter"]},
      {type:"screenshot", screenshot_name:"calculator-dashboard-test.png"}
    ]
  },
  windows: {name:"window-list", actions:[{type:"list_windows"}]}
};

function cfg(){
  return {
    base: $("agentUrl").value.replace(/\/$/,""),
    headers: {"Content-Type":"application/json", "Authorization":`Bearer ${$("token").value}`}
  };
}

function show(value){
  $("output").textContent = typeof value === "string" ? value : JSON.stringify(value,null,2);
}

async function parseResponse(res){
  const data = await res.json().catch(()=>({error:"invalid-json-response"}));
  if(!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function checkHealth(){
  try{
    const {base}=cfg();
    const data=await parseResponse(await fetch(`${base}/health`));
    $("status").textContent=data.busy?"작업 중":"연결됨";
    $("status").className="status ok";
    show(data);
  }catch(e){
    $("status").textContent="연결 실패";
    $("status").className="status bad";
    show(String(e));
  }
}

async function runTask(){
  try{
    const {base,headers}=cfg();
    const payload=JSON.parse($("payload").value);
    show("실행 중...");
    const data=await parseResponse(await fetch(`${base}/run`,{method:"POST",headers,body:JSON.stringify(payload)}));
    show(data);
    await checkHealth();
  }catch(e){show(String(e));}
}

async function loadRuns(){
  try{
    const {base,headers}=cfg();
    show(await parseResponse(await fetch(`${base}/runs`,{headers})));
  }catch(e){show(String(e));}
}

function applyTemplate(){
  $("payload").value=JSON.stringify(templates[$("template").value],null,2);
}

applyTemplate();
