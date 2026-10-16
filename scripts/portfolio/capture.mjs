import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT=path.resolve('portfolio-captures'); await mkdir(OUT,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const manifest={product:'Checkpoint Investment Management Platform',source:'actual React/Astro app',data:'fictional demonstration records only',productionAPI:false,screens:[]};
const people=['Asha Mrema','Neema Joseph','Baraka Kimaro','Daniel Mushi','Rehema Ally','Zawadi Mbise','Juma Said','Mary Mtui'];
const months=[3,4,5,6,7,8,9,10,11,12,1,2];
const loans=people.slice(0,5).map((member_name,i)=>({
 id:101+i,member_id:101+i,member_name,loan_number:'LN-2026-'+(101+i),
 fiscal_year:2026,status:'active',principal:800000+i*150000,interest_amount:96000+i*18000,
 total_repaid:400000+i*85000,balance:400000+i*65000,issued_date:'2026-06-10',due_date:'2026-12-10'
}));
const financial={
 equity:{total:24350000},liabilities:{in_circulation:5250000},active_members:8,active_loans:5,
 cash_at_bank:6800000,contributions_this_fy:4925000,current_fiscal_year:2026,availableLoanYears:[2026],
 cash_position:{live_balance:6800000,reconciled_balance:6650000,reconciled_as_of:'2026-09-30',updated_at:'2026-10-15T10:00:00Z'},
 monthly_stats:months.map((month,i)=>({month,contributions_2026:420000+(i%4)*80000})),
 interest_by_member:people.slice(0,6).map((name,i)=>({name,interest_2026:20000+i*8500})),
 active_loan_list:loans
};
const grid=people.map((member_name,i)=>({
 member_id:101+i,member_name,member_number:'CP-'+(101+i),total:450000+i*18000,
 contributions:months.map((month,j)=>({month,year:month>=3?2025:2026,amount:j<8?75000:0,status:j<8?'paid':'unpaid'})),
 months:months.map((month,j)=>({month,amount:j<8?75000:0,status:j<8?'paid':'unpaid'}))
}));
const admin={id:'demo',name:'Asha Mrema',fullName:'Asha Mrema',email:'asha@example.invalid',role:'admin',member_id:101,organization_id:'demo-org'};
const member={...admin,role:'member'};
const me={id:101,name:'Asha Mrema',contributions:months.slice(0,8).map(month=>({month,year:2026,amount:75000,status:'paid'})),fines:[],loans:loans.slice(0,1)};
function payload(url,mode,method){
 if(method!=='GET')return {code:403,body:{error:'Read-only portfolio capture'}};
 const p=new URL(url).pathname;
 if(p==='/api/auth/me')return {body:mode==='member'?member:admin};
 if(p==='/api/summary')return {body:financial};
 if(p==='/api/summary/snapshot')return {body:{cash_at_bank:6800000,cash_source:'reconciled_physical',cash_as_of:'2026-09-30'}};
 if(p==='/api/notifications/attention')return {body:[]};
 if(p.startsWith('/api/notifications'))return {body:[]};
 if(p==='/api/members/me')return {body:me};
 if(p==='/api/members')return {body:people.map((name,i)=>({id:101+i,name,member_number:'CP-'+(101+i),status:'active',total_contributions:450000+i*25000}))};
 if(p==='/api/loans')return {body:mode==='member'?loans.slice(0,1):loans};
 if(p.startsWith('/api/contributions/grid/'))return {body:{grid,monthlyTotals:months.map(month=>({month,total:525000}))}};
 if(p==='/api/contributions')return {body:me.contributions};
 if(p==='/api/rules'||p==='/api/rules/2026')return {body:{contribution_amount:75000,loan_max_ratio:0.8}};
 if(p==='/api/member/loan-eligibility')return {body:{max_eligible:980000,loan_max_ratio:0.8,interest_rate:0.12,repayment_months:6,total_contributions:1225000,total_loan_interest:145000,paid_fines:0,net_worth:1370000}};
 if(p==='/api/transactions')return {body:{transactions:[]}};
 return {body:[]};
}
async function session(viewport,mode){
 const context=await browser.newContext({viewport,deviceScaleFactor:1,colorScheme:'light',reducedMotion:'reduce',
  locale:'en-TZ',timezoneId:'Africa/Dar_es_Salaam',isMobile:viewport.width<500,hasTouch:viewport.width<500});
 if(mode)await context.addInitScript(()=>localStorage.setItem('cp_token','example-screenshot-token'));
 await context.route('http://127.0.0.1:5173/api/**',async route=>{
  const response=payload(route.request().url(),mode,route.request().method());
  await route.fulfill({status:response.code||200,contentType:'application/json',body:JSON.stringify(response.body)});
 });
 const page=await context.newPage();
 page.on('pageerror',e=>console.warn('PAGE ERROR',e.message));
 page.on('console',message=>{if(message.type()==='error')console.warn('CONSOLE ERROR',message.text().slice(0,600));});
 return {context,page};
}
async function capture(page,name,locator){
 await page.waitForTimeout(700);
 const element=locator?page.locator(locator).first():page;
 await element.screenshot({path:path.join(OUT,name+'.png'),animations:'disabled',timeout:20000});
 manifest.screens.push(name);console.log('CAPTURED',name);
}
try{
 const marketing=await session({width:1600,height:1000},null);
 await marketing.page.goto('http://127.0.0.1:4321/',{waitUntil:'domcontentloaded'});
 await marketing.page.locator('.near-dashboard-window').waitFor({timeout:30000});
 await capture(marketing.page,'01-marketing-hero');
 await capture(marketing.page,'02-product-demo','.near-dashboard-window');
 await capture(marketing.page,'03-feature-showcase','.feature-tabs-container');
 await marketing.context.close();

 const login=await session({width:1600,height:1000},null);
 await login.page.goto('http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
 try { await login.page.locator('#login-identity').waitFor({timeout:20000}); }
 catch(error) {
  console.warn('LOGIN DID NOT LOAD',login.page.url(),(await login.page.locator('body').innerText()).slice(0,1400));
  await capture(login.page,'04-debug-sign-in');
  throw error;
 }
 await capture(login.page,'04-sign-in');
 await login.context.close();

 const a=await session({width:1600,height:1000},'admin');
 await a.page.goto('http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
 await a.page.locator('.admin-overview-page h1').waitFor({timeout:30000});
 await capture(a.page,'05-admin-dashboard');
 await a.page.goto('http://127.0.0.1:5173/contributions',{waitUntil:'domcontentloaded'});
 await a.page.locator('.admin-contributions-page h1').waitFor({timeout:30000});
 await capture(a.page,'06-contribution-tracking');
 await a.page.goto('http://127.0.0.1:5173/loans',{waitUntil:'domcontentloaded'});
 await a.page.getByRole('heading',{name:'Loan Register'}).waitFor({timeout:30000});
 await capture(a.page,'07-loan-register');
 await a.context.close();

 const m=await session({width:390,height:844},'member');
 await m.page.goto('http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
 await m.page.getByText('Welcome, Asha').waitFor({timeout:30000});
 await capture(m.page,'08-member-mobile');
 await m.context.close();
}finally{
 await writeFile(path.join(OUT,'MANIFEST.json'),JSON.stringify(manifest,null,2));
 await browser.close();
}
