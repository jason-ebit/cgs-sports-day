// Photo windows use the original kit photo unchanged, so the labels match the packs.
const KIT_PHOTO = './assets/first-aid/kit-reference-19.png';

export const FIRST_AID_KIT_ITEMS = Object.freeze([
  {name:'Scissors', korean:'가위', detail:'', crop:[488,519,89,213]},
  {name:'Tweezers', korean:'핀셋', detail:'', crop:[578,522,43,200]},
  {name:'Cotton wool', korean:'탈지면', detail:'10 g', crop:[652,534,143,172]},
  {name:'Pre-cut cotton', korean:'절단탈지면', detail:'20 g', crop:[828,565,184,134]},
  {name:'Sterile gauze', korean:'멸균거즈', detail:'5 cm', crop:[460,734,113,126]},
  {name:'Gauze bandage', korean:'거즈붕대', detail:'5 cm', crop:[587,733,91,132]},
  {name:'Gauze bandage', korean:'거즈붕대', detail:'7.5 cm', crop:[688,719,87,148]},
  {name:'Elastic bandage', korean:'탄력붕대', detail:'5 cm', crop:[786,729,111,142]},
  {name:'Cotton medical tape', korean:'면반창고', detail:'Small roll', crop:[897,745,116,119]},
  {name:'Hydrogen peroxide solution', korean:'과산화수소수', detail:'60 ml', crop:[468,879,71,168]},
  {name:'Ethanol disinfectant', korean:'소독용에탄올', detail:'60 ml', crop:[561,878,73,168]},
  {name:'Standard plasters', korean:'상처밴드 (표준)', detail:'100 plasters', crop:[647,876,160,79]},
  {name:'Assorted plasters', korean:'상처밴드 (혼합)', detail:'22 plasters', crop:[648,961,158,97]},
  {name:'Cotton buds', korean:'면봉', detail:'100 buds', crop:[883,899,98,126]},
  {name:'Finger covers', korean:'손가락쌕크', detail:'10 covers', crop:[440,1063,177,166]},
  {name:'Alcohol wipes', korean:'알콜스왑', detail:'10 wipes', crop:[625,1101,172,121]},
  {name:'Medium dressings', korean:'드레싱밴드', detail:'Medium · 6 dressings', crop:[807,1079,113,158]},
  {name:'KF94 mask', korean:'KF94마스크', detail:'', crop:[923,1057,89,201]},
  {name:'Pill organiser', korean:'알약통', detail:'', crop:[643,1237,146,89]},
]);

const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export function renderFirstAidKit() {
  return `<details class="first-aid-kit">
    <summary><span>First-aid kit · ${FIRST_AID_KIT_ITEMS.length} items</span><span class="first-aid-kit-chevron" aria-hidden="true"></span></summary>
    <div class="first-aid-kit-body">
      <p class="first-aid-kit-intro">Match the English name to the photo. Check the actual pack for amounts and expiry dates.</p>
      <ol class="first-aid-kit-grid">${FIRST_AID_KIT_ITEMS.map((item,index) => `<li class="first-aid-kit-item"><figure>
        <svg class="first-aid-kit-photo" viewBox="${item.crop.join(' ')}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHTML(item.name)} — photo from the kit list" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="first-aid-kit-clip-${index}" clipPathUnits="userSpaceOnUse"><rect x="${item.crop[0]}" y="${item.crop[1]}" width="${item.crop[2]}" height="${item.crop[3]}"/></clipPath></defs><image href="${KIT_PHOTO}" width="1080" height="1382" clip-path="url(#first-aid-kit-clip-${index})"/></svg>
        <figcaption><span class="first-aid-kit-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><strong>${escapeHTML(item.name)}</strong><span class="first-aid-kit-korean" lang="ko">${escapeHTML(item.korean)}</span>${item.detail?`<small>${escapeHTML(item.detail)}</small>`:''}</figcaption>
      </figure></li>`).join('')}</ol>
      <a class="first-aid-kit-source" href="${KIT_PHOTO}" target="_blank" rel="noopener">View full kit photo ↗</a>
    </div>
  </details>`;
}
