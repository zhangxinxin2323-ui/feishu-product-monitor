#!/usr/bin/env node
// Usage: node scrape-asin.mjs <ASIN>
// Opens Amazon product page via CDP proxy, extracts all fields, prints JSON to stdout.

const ASIN = process.argv[2];
if (!ASIN) { console.error("Usage: node scrape-asin.mjs <ASIN>"); process.exit(1); }

const BASE = "http://localhost:3456";
const URL = `https://www.amazon.com/dp/${ASIN}`;

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", body });
  return res.json();
}
async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

const JS_EXTRACT = `(() => {
  const p=document.querySelector(".priceToPay .a-offscreen,.a-price .a-offscreen,.apexPriceToPay .a-offscreen");
  let price=null;
  if(p){const m=p.textContent.match(/[\\d,.]+/);if(m)price=parseFloat(m[0].replace(/,/g,""));}

  const re=document.querySelector("#acrPopover .a-icon-alt");
  const rv=document.querySelector("#acrCustomerReviewText");
  const rating=re?parseFloat(re.textContent.match(/[\\d.]+/)?.[0]):null;
  const reviews=rv?parseInt(rv.textContent.replace(/[^\\d]/g,"")):null;

  const a=document.querySelector("#availability");
  let stock="InStock";
  if(a){const t=a.textContent.toLowerCase();if(t.includes("out of stock"))stock="OutOfStock";else if(t.includes("pre-order"))stock="PreOrder";}

  let bsr="";
  document.querySelectorAll("th,.a-text-bold,span").forEach(el=>{
    if(el.textContent.includes("Best Sellers Rank")){bsr=el.closest("tr,li,.a-section")?.innerText||"";}
  });
  const all=[...bsr.matchAll(/#([\\d,]+)\\s+in\\s+([^\\(\\n]+)/g)];
  const sub=all.length>1?all[1]:all[0];
  const rank=sub?parseInt(sub[1].replace(/,/g,"")):null;
  const cat=sub?sub[2].trim():null;

  let promo="None";
  if(document.querySelector("[id^=couponText],.couponBadge"))promo="Coupon";
  else if(document.querySelector("#dealBadge,.dealBadge"))promo="Deal";
  else if(document.querySelector("#snsDetailPageVariation,.sns-base-price"))promo="SnS";

  const neg=[];
  document.querySelectorAll("[data-hook=review]").forEach(r=>{
    const s=r.querySelector("[data-hook=review-star-rating] .a-icon-alt");
    if(!s)return;
    const st=parseFloat(s.textContent.match(/[\\d.]+/)?.[0]||"5");
    if(st<=3){
      const b=r.querySelector("[data-hook=review-body] span")?.textContent?.trim()||"";
      const ti=r.querySelector("[data-hook=review-title] span")?.textContent?.trim()||"";
      if(b)neg.push("["+st+"] "+ti+": "+b.substring(0,200));
    }
  });
  const negText=neg.length>0?neg.join(" | "):"None";

  const hasTitle=!!document.querySelector("#productTitle");
  const img=document.querySelectorAll("#altImages .a-button-thumbnail img,.imgTagWrapper img").length;
  const bul=document.querySelectorAll("#feature-bullets .a-list-item").length;
  const ap=!!document.querySelector("#aplus,#aplus_feature_div,.aplus-v2");
  const comp=(hasTitle&&img>=6&&bul>=3&&ap)?"Complete":"Incomplete";

  return JSON.stringify({price,rating,reviews,stock,rank,cat,promo,negText,comp});
})()`;

try {
  // Open new blank tab first
  const { targetId } = await get(`/new?url=about:blank`);
  if (!targetId) throw new Error("Failed to open tab");

  // Navigate to Amazon page (may timeout but page still loads)
  try { await get(`/navigate?target=${targetId}&url=${encodeURIComponent(URL)}`); } catch {}

  // Wait for page to fully render
  await new Promise(r => setTimeout(r, 5000));

  // Verify page loaded
  const titleCheck = await post(`/eval?target=${targetId}`, 'document.title');
  if (!titleCheck.value || titleCheck.value === '' || titleCheck.value.includes('Page Not Found')) {
    await get(`/close?target=${targetId}`);
    console.log(JSON.stringify({ error: "Page failed to load or not found" }));
    process.exit(0);
  }

  // Scroll down to load BSR / reviews
  await get(`/scroll?target=${targetId}&direction=bottom`);
  await new Promise(r => setTimeout(r, 2000));

  // Scroll back up to ensure price area is rendered
  await get(`/scroll?target=${targetId}&direction=top`);
  await new Promise(r => setTimeout(r, 1500));

  // Extract data
  const result = await post(`/eval?target=${targetId}`, JS_EXTRACT);

  // Close tab
  await get(`/close?target=${targetId}`);

  if (result.value) {
    const data = JSON.parse(result.value);
    // Map to Chinese field names for Feishu
    const output = {
      price: data.price,
      rating: data.rating,
      reviews: data.reviews,
      stock: data.stock === "InStock" ? "有货" : data.stock === "OutOfStock" ? "缺货" : "预售",
      rank: data.rank,
      cat: data.cat,
      promo: data.promo === "None" ? "无" : data.promo,
      negText: data.negText === "None" ? "无" : data.negText,
      comp: data.comp === "Complete" ? "完整" : "不完整"
    };
    console.log(JSON.stringify(output));
  } else {
    console.log(JSON.stringify({ error: result.error || "no data" }));
  }
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
}
