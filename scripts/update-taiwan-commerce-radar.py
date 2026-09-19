#!/usr/bin/env python3
"""Refresh Taiwan commerce benchmark without breaking the dashboard when a site blocks scraping."""
from __future__ import annotations
import json, re, ssl, urllib.request
from datetime import datetime, timezone, timedelta
from html import unescape
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"strategy/taiwan-commerce-radar/data/latest.json"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
KST=timezone(timedelta(hours=9))

def fetch(url):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept-Language":"zh-TW,zh;q=0.9,en;q=0.7"})
    ctx=ssl.create_default_context()
    with urllib.request.urlopen(req,timeout=25,context=ctx) as r:
        return r.read().decode("utf-8","ignore")

def textify(s):
    s=re.sub(r"<script[\s\S]*?</script>"," ",s,flags=re.I)
    s=re.sub(r"<style[\s\S]*?</style>"," ",s,flags=re.I)
    s=re.sub(r"<[^>]+>"," ",s)
    return re.sub(r"\s+"," ",unescape(s)).strip()

def find_price(txt, patterns):
    for pat in patterns:
        m=re.search(pat,txt,re.I)
        if m:
            return int(m.group(1).replace(",",""))
    return None

def update_entry(e):
    url=e["sourceUrl"]
    try:
        raw=fetch(url); txt=textify(raw)
        p=None
        if e["platform"]=="Coupang Taiwan":
            p=find_price(txt,[r"256GB.{0,700}?\$([0-9]{2,3},[0-9]{3})",r"折扣後價格\s*\$([0-9]{2,3},[0-9]{3})"])
        elif e["platform"]=="Shopee TW":
            p=find_price(txt,[r"iPhone 17 256G.{0,900}?\$([0-9]{2,3},[0-9]{3})",r"\$([0-9]{2,3},[0-9]{3}).{0,300}?iPhone 17"])
        elif e["platform"]=="momo":
            p=find_price(txt,[r"iPhone 17\(256G[^)]*\).{0,500}?([0-9]{2,3},[0-9]{3})"])
        elif e["platform"]=="PChome 24h":
            p=find_price(txt,[r"iPhone 17 \(256G\)\s*\$([0-9]{2,3},[0-9]{3})",r"iPhone 17 256GB.{0,500}?\$([0-9]{2,3},[0-9]{3})"])
        if p and 15000 <= p <= 50000:
            e["priceTwd"]=p
            e["status"]="ok"
            e["observedAt"]=datetime.now(KST).strftime("%Y-%m-%d")
            e["note"]=re.sub(r"^자동수집[^.]*\.\s*","",e.get("note",""))
        else:
            e["status"]="stale"
    except Exception:
        e["status"]="stale"
    return e

def main():
    d=json.loads(OUT.read_text(encoding="utf-8"))
    d["entries"]=[update_entry(dict(e)) for e in d.get("entries",[])]
    d["updatedAt"]=datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")
    OUT.write_text(json.dumps(d,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("updated",OUT)
    for e in d["entries"]:
        print(e["platform"],e["status"],e.get("priceTwd"))

if __name__=="__main__":
    main()
