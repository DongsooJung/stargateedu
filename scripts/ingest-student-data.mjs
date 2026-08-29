import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = resolve("teacher-screening/data/authorized-input.json");
const csvPath = process.env.STUDENT_CSV_PATH?.trim();
const firecrawlUrl = process.env.FIRECRAWL_STUDENT_URL?.trim();
const firecrawlKey = process.env.FIRECRAWL_API_KEY?.trim();

function parseCsv(text) {
  const rows=[]; let row=[], cell="", quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){cell+='"';i++;} else quoted=!quoted; }
    else if(c===','&&!quoted){row.push(cell);cell="";}
    else if((c==='\n'||c==='\r')&&!quoted){ if(c==='\r'&&text[i+1]==='\n')i++; row.push(cell); if(row.some(v=>v.trim()))rows.push(row); row=[];cell=""; }
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row)}
  if(!rows.length)return [];
  const headers=rows.shift().map(v=>v.trim());
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??"").trim()])));
}

function normalize(x,index){
  const pick=(...keys)=>{for(const k of keys)if(x[k]!==undefined&&x[k]!=="")return x[k];return undefined};
  return {
    externalId:String(pick("externalId","id","번호")??`IMPORT-${index+1}`),
    displayName:String(pick("displayName","name","이름")??`익명 학생 ${index+1}`),
    subject:String(pick("subject","과목")??"기타"),
    region:String(pick("region","지역")??"미기재"),
    schoolLevel:String(pick("schoolLevel","grade","학년")??"미기재"),
    goal:String(pick("goal","목표","문의내용")??"상담 필요"),
    weeklySessions:Number(pick("weeklySessions","주횟수")??1),
    budgetMonthly:Number(pick("budgetMonthly","budget","월예산")??0),
    scheduleFit:Number(pick("scheduleFit","일정적합도")??60),
    guardianVerified:[true,"true","1","Y","y","확인"].includes(pick("guardianVerified","verified","보호자확인")),
    remote:[true,"true","1","Y","y","온라인"].includes(pick("remote","온라인")),
    requestedAt:String(pick("requestedAt","문의일","date")??new Date().toISOString()),
    profileUrl:pick("profileUrl","url","링크")??null
  };
}

async function fromCsv(){
  if(!csvPath)return [];
  return parseCsv(await readFile(resolve(csvPath),"utf8")).map(normalize);
}

async function robotsAllows(target){
  const url=new URL(target); const r=await fetch(new URL("/robots.txt",url),{signal:AbortSignal.timeout(15000)});
  if(!r.ok)return true;
  const lines=(await r.text()).split(/\r?\n/).map(x=>x.replace(/#.*$/,"").trim());
  let applies=false; const dis=[];
  for(const line of lines){if(!line)continue; const [a,...b]=line.split(":");const k=a.toLowerCase(),v=b.join(":").trim();if(k==="user-agent")applies=v==="*";if(applies&&k==="disallow"&&v)dis.push(v)}
  return !dis.some(rule=>rule==="/"||url.pathname.startsWith(rule));
}

async function fromFirecrawl(){
  if(!firecrawlUrl||!firecrawlKey)return [];
  if(!(await robotsAllows(firecrawlUrl))) { console.log("Firecrawl skipped: robots.txt disallows target"); return []; }
  const response=await fetch("https://api.firecrawl.dev/v2/scrape",{method:"POST",headers:{authorization:`Bearer ${firecrawlKey}`,"content-type":"application/json"},body:JSON.stringify({url:firecrawlUrl,formats:["json"],jsonOptions:{prompt:"Extract tutoring/student inquiry records visible on this public page. Return an object with a candidates array. For each record use externalId, displayName, subject, region, schoolLevel, goal, weeklySessions, budgetMonthly, scheduleFit, guardianVerified, remote, requestedAt, profileUrl when present. Do not infer private or hidden data."},onlyMainContent:true,maxAge:0,zeroDataRetention:true}),signal:AbortSignal.timeout(90000)});
  const result=await response.json(); if(!response.ok||!result.success)throw new Error(`Firecrawl failed: ${result.error??response.status}`);
  const data=result.data?.json; const arr=Array.isArray(data)?data:(data?.candidates??data?.students??[]);
  return Array.isArray(arr)?arr.map(normalize):[];
}

const csv=await fromCsv(); const firecrawl=await fromFirecrawl();
const seen=new Set(); const candidates=[...csv,...firecrawl].filter(x=>{const key=x.externalId||JSON.stringify([x.displayName,x.subject,x.region,x.requestedAt]);if(seen.has(key))return false;seen.add(key);return true});
await mkdir(dirname(outputPath),{recursive:true});
await writeFile(outputPath,JSON.stringify({source:"authorized-ingestion",updatedAt:new Date().toISOString(),csvCount:csv.length,firecrawlCount:firecrawl.length,candidates},null,2)+"\n","utf8");
console.log(`Authorized ingestion complete: CSV ${csv.length}, Firecrawl ${firecrawl.length}, total ${candidates.length}`);
