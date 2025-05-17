/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const e=window,t=e.ShadowRoot&&(void 0===e.ShadyCSS||e.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,s=Symbol(),i=new WeakMap;let a=class{constructor(e,t,i){if(this._$cssResult$=!0,i!==s)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o;const s=this.t;if(t&&void 0===e){const t=void 0!==s&&1===s.length;t&&(e=i.get(s)),void 0===e&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),t&&i.set(s,e))}return e}toString(){return this.cssText}};const r=(e,...t)=>{const i=1===e.length?e[0]:t.reduce(((t,s,i)=>t+(e=>{if(!0===e._$cssResult$)return e.cssText;if("number"==typeof e)return e;throw Error("Value passed to 'css' function must be a 'css' function result: "+e+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(s)+e[i+1]),e[0]);return new a(i,e,s)},n=t?e=>e:e=>e instanceof CSSStyleSheet?(e=>{let t="";for(const s of e.cssRules)t+=s.cssText;return(e=>new a("string"==typeof e?e:e+"",void 0,s))(t)})(e):e
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */;var o;const l=window,h=l.trustedTypes,g=h?h.emptyScript:"",d=l.reactiveElementPolyfillSupport,p={toAttribute(e,t){switch(t){case Boolean:e=e?g:null;break;case Object:case Array:e=null==e?e:JSON.stringify(e)}return e},fromAttribute(e,t){let s=e;switch(t){case Boolean:s=null!==e;break;case Number:s=null===e?null:Number(e);break;case Object:case Array:try{s=JSON.parse(e)}catch(e){s=null}}return s}},c=(e,t)=>t!==e&&(t==t||e==e),_={attribute:!0,type:String,converter:p,reflect:!1,hasChanged:c},m="finalized";let u=class extends HTMLElement{constructor(){super(),this._$Ei=new Map,this.isUpdatePending=!1,this.hasUpdated=!1,this._$El=null,this._$Eu()}static addInitializer(e){var t;this.finalize(),(null!==(t=this.h)&&void 0!==t?t:this.h=[]).push(e)}static get observedAttributes(){this.finalize();const e=[];return this.elementProperties.forEach(((t,s)=>{const i=this._$Ep(s,t);void 0!==i&&(this._$Ev.set(i,s),e.push(i))})),e}static createProperty(e,t=_){if(t.state&&(t.attribute=!1),this.finalize(),this.elementProperties.set(e,t),!t.noAccessor&&!this.prototype.hasOwnProperty(e)){const s="symbol"==typeof e?Symbol():"__"+e,i=this.getPropertyDescriptor(e,s,t);void 0!==i&&Object.defineProperty(this.prototype,e,i)}}static getPropertyDescriptor(e,t,s){return{get(){return this[t]},set(i){const a=this[e];this[t]=i,this.requestUpdate(e,a,s)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)||_}static finalize(){if(this.hasOwnProperty(m))return!1;this[m]=!0;const e=Object.getPrototypeOf(this);if(e.finalize(),void 0!==e.h&&(this.h=[...e.h]),this.elementProperties=new Map(e.elementProperties),this._$Ev=new Map,this.hasOwnProperty("properties")){const e=this.properties,t=[...Object.getOwnPropertyNames(e),...Object.getOwnPropertySymbols(e)];for(const s of t)this.createProperty(s,e[s])}return this.elementStyles=this.finalizeStyles(this.styles),!0}static finalizeStyles(e){const t=[];if(Array.isArray(e)){const s=new Set(e.flat(1/0).reverse());for(const e of s)t.unshift(n(e))}else void 0!==e&&t.push(n(e));return t}static _$Ep(e,t){const s=t.attribute;return!1===s?void 0:"string"==typeof s?s:"string"==typeof e?e.toLowerCase():void 0}_$Eu(){var e;this._$E_=new Promise((e=>this.enableUpdating=e)),this._$AL=new Map,this._$Eg(),this.requestUpdate(),null===(e=this.constructor.h)||void 0===e||e.forEach((e=>e(this)))}addController(e){var t,s;(null!==(t=this._$ES)&&void 0!==t?t:this._$ES=[]).push(e),void 0!==this.renderRoot&&this.isConnected&&(null===(s=e.hostConnected)||void 0===s||s.call(e))}removeController(e){var t;null===(t=this._$ES)||void 0===t||t.splice(this._$ES.indexOf(e)>>>0,1)}_$Eg(){this.constructor.elementProperties.forEach(((e,t)=>{this.hasOwnProperty(t)&&(this._$Ei.set(t,this[t]),delete this[t])}))}createRenderRoot(){var s;const i=null!==(s=this.shadowRoot)&&void 0!==s?s:this.attachShadow(this.constructor.shadowRootOptions);return((s,i)=>{t?s.adoptedStyleSheets=i.map((e=>e instanceof CSSStyleSheet?e:e.styleSheet)):i.forEach((t=>{const i=document.createElement("style"),a=e.litNonce;void 0!==a&&i.setAttribute("nonce",a),i.textContent=t.cssText,s.appendChild(i)}))})(i,this.constructor.elementStyles),i}connectedCallback(){var e;void 0===this.renderRoot&&(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),null===(e=this._$ES)||void 0===e||e.forEach((e=>{var t;return null===(t=e.hostConnected)||void 0===t?void 0:t.call(e)}))}enableUpdating(e){}disconnectedCallback(){var e;null===(e=this._$ES)||void 0===e||e.forEach((e=>{var t;return null===(t=e.hostDisconnected)||void 0===t?void 0:t.call(e)}))}attributeChangedCallback(e,t,s){this._$AK(e,s)}_$EO(e,t,s=_){var i;const a=this.constructor._$Ep(e,s);if(void 0!==a&&!0===s.reflect){const r=(void 0!==(null===(i=s.converter)||void 0===i?void 0:i.toAttribute)?s.converter:p).toAttribute(t,s.type);this._$El=e,null==r?this.removeAttribute(a):this.setAttribute(a,r),this._$El=null}}_$AK(e,t){var s;const i=this.constructor,a=i._$Ev.get(e);if(void 0!==a&&this._$El!==a){const e=i.getPropertyOptions(a),r="function"==typeof e.converter?{fromAttribute:e.converter}:void 0!==(null===(s=e.converter)||void 0===s?void 0:s.fromAttribute)?e.converter:p;this._$El=a,this[a]=r.fromAttribute(t,e.type),this._$El=null}}requestUpdate(e,t,s){let i=!0;void 0!==e&&(((s=s||this.constructor.getPropertyOptions(e)).hasChanged||c)(this[e],t)?(this._$AL.has(e)||this._$AL.set(e,t),!0===s.reflect&&this._$El!==e&&(void 0===this._$EC&&(this._$EC=new Map),this._$EC.set(e,s))):i=!1),!this.isUpdatePending&&i&&(this._$E_=this._$Ej())}async _$Ej(){this.isUpdatePending=!0;try{await this._$E_}catch(e){Promise.reject(e)}const e=this.scheduleUpdate();return null!=e&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){var e;if(!this.isUpdatePending)return;this.hasUpdated,this._$Ei&&(this._$Ei.forEach(((e,t)=>this[t]=e)),this._$Ei=void 0);let t=!1;const s=this._$AL;try{t=this.shouldUpdate(s),t?(this.willUpdate(s),null===(e=this._$ES)||void 0===e||e.forEach((e=>{var t;return null===(t=e.hostUpdate)||void 0===t?void 0:t.call(e)})),this.update(s)):this._$Ek()}catch(e){throw t=!1,this._$Ek(),e}t&&this._$AE(s)}willUpdate(e){}_$AE(e){var t;null===(t=this._$ES)||void 0===t||t.forEach((e=>{var t;return null===(t=e.hostUpdated)||void 0===t?void 0:t.call(e)})),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$Ek(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$E_}shouldUpdate(e){return!0}update(e){void 0!==this._$EC&&(this._$EC.forEach(((e,t)=>this._$EO(t,this[t],e))),this._$EC=void 0),this._$Ek()}updated(e){}firstUpdated(e){}};
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
var f;u[m]=!0,u.elementProperties=new Map,u.elementStyles=[],u.shadowRootOptions={mode:"open"},null==d||d({ReactiveElement:u}),(null!==(o=l.reactiveElementVersions)&&void 0!==o?o:l.reactiveElementVersions=[]).push("1.6.3");const v=window,$=v.trustedTypes,y=$?$.createPolicy("lit-html",{createHTML:e=>e}):void 0,w="$lit$",b=`lit$${(Math.random()+"").slice(9)}$`,A="?"+b,U=`<${A}>`,k=document,R=()=>k.createComment(""),L=e=>null===e||"object"!=typeof e&&"function"!=typeof e,C=Array.isArray,S="[ \t\n\f\r]",x=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,E=/-->/g,H=/>/g,P=RegExp(`>|${S}(?:([^\\s"'>=/]+)(${S}*=${S}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,"g"),j=/'/g,N=/"/g,M=/^(?:script|style|textarea|title)$/i,O=(e=>(t,...s)=>({_$litType$:e,strings:t,values:s}))(1),T=Symbol.for("lit-noChange"),D=Symbol.for("lit-nothing"),B=new WeakMap,z=k.createTreeWalker(k,129,null,!1);function I(e,t){if(!Array.isArray(e)||!e.hasOwnProperty("raw"))throw Error("invalid template strings array");return void 0!==y?y.createHTML(t):t}const V=(e,t)=>{const s=e.length-1,i=[];let a,r=2===t?"<svg>":"",n=x;for(let t=0;t<s;t++){const s=e[t];let o,l,h=-1,g=0;for(;g<s.length&&(n.lastIndex=g,l=n.exec(s),null!==l);)g=n.lastIndex,n===x?"!--"===l[1]?n=E:void 0!==l[1]?n=H:void 0!==l[2]?(M.test(l[2])&&(a=RegExp("</"+l[2],"g")),n=P):void 0!==l[3]&&(n=P):n===P?">"===l[0]?(n=null!=a?a:x,h=-1):void 0===l[1]?h=-2:(h=n.lastIndex-l[2].length,o=l[1],n=void 0===l[3]?P:'"'===l[3]?N:j):n===N||n===j?n=P:n===E||n===H?n=x:(n=P,a=void 0);const d=n===P&&e[t+1].startsWith("/>")?" ":"";r+=n===x?s+U:h>=0?(i.push(o),s.slice(0,h)+w+s.slice(h)+b+d):s+b+(-2===h?(i.push(void 0),t):d)}return[I(e,r+(e[s]||"<?>")+(2===t?"</svg>":"")),i]};class F{constructor({strings:e,_$litType$:t},s){let i;this.parts=[];let a=0,r=0;const n=e.length-1,o=this.parts,[l,h]=V(e,t);if(this.el=F.createElement(l,s),z.currentNode=this.el.content,2===t){const e=this.el.content,t=e.firstChild;t.remove(),e.append(...t.childNodes)}for(;null!==(i=z.nextNode())&&o.length<n;){if(1===i.nodeType){if(i.hasAttributes()){const e=[];for(const t of i.getAttributeNames())if(t.endsWith(w)||t.startsWith(b)){const s=h[r++];if(e.push(t),void 0!==s){const e=i.getAttribute(s.toLowerCase()+w).split(b),t=/([.?@])?(.*)/.exec(s);o.push({type:1,index:a,name:t[2],strings:e,ctor:"."===t[1]?q:"?"===t[1]?Z:"@"===t[1]?Q:Y})}else o.push({type:6,index:a})}for(const t of e)i.removeAttribute(t)}if(M.test(i.tagName)){const e=i.textContent.split(b),t=e.length-1;if(t>0){i.textContent=$?$.emptyScript:"";for(let s=0;s<t;s++)i.append(e[s],R()),z.nextNode(),o.push({type:2,index:++a});i.append(e[t],R())}}}else if(8===i.nodeType)if(i.data===A)o.push({type:2,index:a});else{let e=-1;for(;-1!==(e=i.data.indexOf(b,e+1));)o.push({type:7,index:a}),e+=b.length-1}a++}}static createElement(e,t){const s=k.createElement("template");return s.innerHTML=e,s}}function W(e,t,s=e,i){var a,r,n,o;if(t===T)return t;let l=void 0!==i?null===(a=s._$Co)||void 0===a?void 0:a[i]:s._$Cl;const h=L(t)?void 0:t._$litDirective$;return(null==l?void 0:l.constructor)!==h&&(null===(r=null==l?void 0:l._$AO)||void 0===r||r.call(l,!1),void 0===h?l=void 0:(l=new h(e),l._$AT(e,s,i)),void 0!==i?(null!==(n=(o=s)._$Co)&&void 0!==n?n:o._$Co=[])[i]=l:s._$Cl=l),void 0!==l&&(t=W(e,l._$AS(e,t.values),l,i)),t}class G{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){var t;const{el:{content:s},parts:i}=this._$AD,a=(null!==(t=null==e?void 0:e.creationScope)&&void 0!==t?t:k).importNode(s,!0);z.currentNode=a;let r=z.nextNode(),n=0,o=0,l=i[0];for(;void 0!==l;){if(n===l.index){let t;2===l.type?t=new J(r,r.nextSibling,this,e):1===l.type?t=new l.ctor(r,l.name,l.strings,this,e):6===l.type&&(t=new X(r,this,e)),this._$AV.push(t),l=i[++o]}n!==(null==l?void 0:l.index)&&(r=z.nextNode(),n++)}return z.currentNode=k,a}v(e){let t=0;for(const s of this._$AV)void 0!==s&&(void 0!==s.strings?(s._$AI(e,s,t),t+=s.strings.length-2):s._$AI(e[t])),t++}}class J{constructor(e,t,s,i){var a;this.type=2,this._$AH=D,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=s,this.options=i,this._$Cp=null===(a=null==i?void 0:i.isConnected)||void 0===a||a}get _$AU(){var e,t;return null!==(t=null===(e=this._$AM)||void 0===e?void 0:e._$AU)&&void 0!==t?t:this._$Cp}get parentNode(){let e=this._$AA.parentNode;const t=this._$AM;return void 0!==t&&11===(null==e?void 0:e.nodeType)&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=W(this,e,t),L(e)?e===D||null==e||""===e?(this._$AH!==D&&this._$AR(),this._$AH=D):e!==this._$AH&&e!==T&&this._(e):void 0!==e._$litType$?this.g(e):void 0!==e.nodeType?this.$(e):(e=>C(e)||"function"==typeof(null==e?void 0:e[Symbol.iterator]))(e)?this.T(e):this._(e)}k(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}$(e){this._$AH!==e&&(this._$AR(),this._$AH=this.k(e))}_(e){this._$AH!==D&&L(this._$AH)?this._$AA.nextSibling.data=e:this.$(k.createTextNode(e)),this._$AH=e}g(e){var t;const{values:s,_$litType$:i}=e,a="number"==typeof i?this._$AC(e):(void 0===i.el&&(i.el=F.createElement(I(i.h,i.h[0]),this.options)),i);if((null===(t=this._$AH)||void 0===t?void 0:t._$AD)===a)this._$AH.v(s);else{const e=new G(a,this),t=e.u(this.options);e.v(s),this.$(t),this._$AH=e}}_$AC(e){let t=B.get(e.strings);return void 0===t&&B.set(e.strings,t=new F(e)),t}T(e){C(this._$AH)||(this._$AH=[],this._$AR());const t=this._$AH;let s,i=0;for(const a of e)i===t.length?t.push(s=new J(this.k(R()),this.k(R()),this,this.options)):s=t[i],s._$AI(a),i++;i<t.length&&(this._$AR(s&&s._$AB.nextSibling,i),t.length=i)}_$AR(e=this._$AA.nextSibling,t){var s;for(null===(s=this._$AP)||void 0===s||s.call(this,!1,!0,t);e&&e!==this._$AB;){const t=e.nextSibling;e.remove(),e=t}}setConnected(e){var t;void 0===this._$AM&&(this._$Cp=e,null===(t=this._$AP)||void 0===t||t.call(this,e))}}class Y{constructor(e,t,s,i,a){this.type=1,this._$AH=D,this._$AN=void 0,this.element=e,this.name=t,this._$AM=i,this.options=a,s.length>2||""!==s[0]||""!==s[1]?(this._$AH=Array(s.length-1).fill(new String),this.strings=s):this._$AH=D}get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}_$AI(e,t=this,s,i){const a=this.strings;let r=!1;if(void 0===a)e=W(this,e,t,0),r=!L(e)||e!==this._$AH&&e!==T,r&&(this._$AH=e);else{const i=e;let n,o;for(e=a[0],n=0;n<a.length-1;n++)o=W(this,i[s+n],t,n),o===T&&(o=this._$AH[n]),r||(r=!L(o)||o!==this._$AH[n]),o===D?e=D:e!==D&&(e+=(null!=o?o:"")+a[n+1]),this._$AH[n]=o}r&&!i&&this.j(e)}j(e){e===D?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,null!=e?e:"")}}class q extends Y{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===D?void 0:e}}const K=$?$.emptyScript:"";class Z extends Y{constructor(){super(...arguments),this.type=4}j(e){e&&e!==D?this.element.setAttribute(this.name,K):this.element.removeAttribute(this.name)}}class Q extends Y{constructor(e,t,s,i,a){super(e,t,s,i,a),this.type=5}_$AI(e,t=this){var s;if((e=null!==(s=W(this,e,t,0))&&void 0!==s?s:D)===T)return;const i=this._$AH,a=e===D&&i!==D||e.capture!==i.capture||e.once!==i.once||e.passive!==i.passive,r=e!==D&&(i===D||a);a&&this.element.removeEventListener(this.name,this,i),r&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){var t,s;"function"==typeof this._$AH?this._$AH.call(null!==(s=null===(t=this.options)||void 0===t?void 0:t.host)&&void 0!==s?s:this.element,e):this._$AH.handleEvent(e)}}class X{constructor(e,t,s){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=s}get _$AU(){return this._$AM._$AU}_$AI(e){W(this,e)}}const ee=v.litHtmlPolyfillSupport;null==ee||ee(F,J),(null!==(f=v.litHtmlVersions)&&void 0!==f?f:v.litHtmlVersions=[]).push("2.8.0");
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
var te,se;class ie extends u{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var e,t;const s=super.createRenderRoot();return null!==(e=(t=this.renderOptions).renderBefore)&&void 0!==e||(t.renderBefore=s.firstChild),s}update(e){const t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=((e,t,s)=>{var i,a;const r=null!==(i=null==s?void 0:s.renderBefore)&&void 0!==i?i:t;let n=r._$litPart$;if(void 0===n){const e=null!==(a=null==s?void 0:s.renderBefore)&&void 0!==a?a:null;r._$litPart$=n=new J(t.insertBefore(R(),e),e,void 0,null!=s?s:{})}return n._$AI(e),n})(t,this.renderRoot,this.renderOptions)}connectedCallback(){var e;super.connectedCallback(),null===(e=this._$Do)||void 0===e||e.setConnected(!0)}disconnectedCallback(){var e;super.disconnectedCallback(),null===(e=this._$Do)||void 0===e||e.setConnected(!1)}render(){return T}}ie.finalized=!0,ie._$litElement$=!0,null===(te=globalThis.litElementHydrateSupport)||void 0===te||te.call(globalThis,{LitElement:ie});const ae=globalThis.litElementPolyfillSupport;null==ae||ae({LitElement:ie}),(null!==(se=globalThis.litElementVersions)&&void 0!==se?se:globalThis.litElementVersions=[]).push("3.3.3");const re={"-1_png":new URL("./images/-1.png",import.meta.url).href,"0_png":new URL("./images/0.png",import.meta.url).href,"1_png":new URL("./images/1.png",import.meta.url).href,"2_png":new URL("./images/2.png",import.meta.url).href,"3_png":new URL("./images/3.png",import.meta.url).href,"4_png":new URL("./images/4.png",import.meta.url).href,"5_png":new URL("./images/5.png",import.meta.url).href,"6_png":new URL("./images/6.png",import.meta.url).href,"al_-1_png":new URL("./images/al_-1.png",import.meta.url).href,al_0_png:new URL("./images/al_0.png",import.meta.url).href,al_1_png:new URL("./images/al_1.png",import.meta.url).href,al_2_png:new URL("./images/al_2.png",import.meta.url).href,al_3_png:new URL("./images/al_3.png",import.meta.url).href,al_4_png:new URL("./images/al_4.png",import.meta.url).href,al_5_png:new URL("./images/al_5.png",import.meta.url).href,al_6_png:new URL("./images/al_6.png",import.meta.url).href,alm_0_png:new URL("./images/alm_0.png",import.meta.url).href,alm_1_png:new URL("./images/alm_1.png",import.meta.url).href,alm_2_png:new URL("./images/alm_2.png",import.meta.url).href,alm_3_png:new URL("./images/alm_3.png",import.meta.url).href,alm_4_png:new URL("./images/alm_4.png",import.meta.url).href,alm_5_png:new URL("./images/alm_5.png",import.meta.url).href,alm_6_png:new URL("./images/alm_6.png",import.meta.url).href,"bjork_-1_png":new URL("./images/bjork_-1.png",import.meta.url).href,bjork_0_png:new URL("./images/bjork_0.png",import.meta.url).href,bjork_1_png:new URL("./images/bjork_1.png",import.meta.url).href,bjork_2_png:new URL("./images/bjork_2.png",import.meta.url).href,bjork_3_png:new URL("./images/bjork_3.png",import.meta.url).href,bjork_4_png:new URL("./images/bjork_4.png",import.meta.url).href,bjork_5_png:new URL("./images/bjork_5.png",import.meta.url).href,bjork_6_png:new URL("./images/bjork_6.png",import.meta.url).href,"bok_-1_png":new URL("./images/bok_-1.png",import.meta.url).href,bok_0_png:new URL("./images/bok_0.png",import.meta.url).href,bok_1_png:new URL("./images/bok_1.png",import.meta.url).href,bok_2_png:new URL("./images/bok_2.png",import.meta.url).href,bok_3_png:new URL("./images/bok_3.png",import.meta.url).href,bok_4_png:new URL("./images/bok_4.png",import.meta.url).href,bok_5_png:new URL("./images/bok_5.png",import.meta.url).href,bok_6_png:new URL("./images/bok_6.png",import.meta.url).href,"ek_-1_png":new URL("./images/ek_-1.png",import.meta.url).href,ek_0_png:new URL("./images/ek_0.png",import.meta.url).href,ek_1_png:new URL("./images/ek_1.png",import.meta.url).href,ek_2_png:new URL("./images/ek_2.png",import.meta.url).href,ek_3_png:new URL("./images/ek_3.png",import.meta.url).href,ek_4_png:new URL("./images/ek_4.png",import.meta.url).href,ek_5_png:new URL("./images/ek_5.png",import.meta.url).href,ek_6_png:new URL("./images/ek_6.png",import.meta.url).href,"grabo_-1_png":new URL("./images/grabo_-1.png",import.meta.url).href,grabo_0_png:new URL("./images/grabo_0.png",import.meta.url).href,grabo_1_png:new URL("./images/grabo_1.png",import.meta.url).href,grabo_2_png:new URL("./images/grabo_2.png",import.meta.url).href,grabo_3_png:new URL("./images/grabo_3.png",import.meta.url).href,grabo_4_png:new URL("./images/grabo_4.png",import.meta.url).href,grabo_5_png:new URL("./images/grabo_5.png",import.meta.url).href,grabo_6_png:new URL("./images/grabo_6.png",import.meta.url).href,"gras_-1_png":new URL("./images/gras_-1.png",import.meta.url).href,gras_0_png:new URL("./images/gras_0.png",import.meta.url).href,gras_1_png:new URL("./images/gras_1.png",import.meta.url).href,gras_2_png:new URL("./images/gras_2.png",import.meta.url).href,gras_3_png:new URL("./images/gras_3.png",import.meta.url).href,gras_4_png:new URL("./images/gras_4.png",import.meta.url).href,gras_5_png:new URL("./images/gras_5.png",import.meta.url).href,gras_6_png:new URL("./images/gras_6.png",import.meta.url).href,"hassel_-1_png":new URL("./images/hassel_-1.png",import.meta.url).href,hassel_0_png:new URL("./images/hassel_0.png",import.meta.url).href,hassel_1_png:new URL("./images/hassel_1.png",import.meta.url).href,hassel_2_png:new URL("./images/hassel_2.png",import.meta.url).href,hassel_3_png:new URL("./images/hassel_3.png",import.meta.url).href,hassel_4_png:new URL("./images/hassel_4.png",import.meta.url).href,hassel_5_png:new URL("./images/hassel_5.png",import.meta.url).href,hassel_6_png:new URL("./images/hassel_6.png",import.meta.url).href,"malortsambrosia_-1_png":new URL("./images/malortsambrosia_-1.png",import.meta.url).href,malortsambrosia_0_png:new URL("./images/malortsambrosia_0.png",import.meta.url).href,malortsambrosia_1_png:new URL("./images/malortsambrosia_1.png",import.meta.url).href,malortsambrosia_2_png:new URL("./images/malortsambrosia_2.png",import.meta.url).href,malortsambrosia_3_png:new URL("./images/malortsambrosia_3.png",import.meta.url).href,malortsambrosia_4_png:new URL("./images/malortsambrosia_4.png",import.meta.url).href,malortsambrosia_5_png:new URL("./images/malortsambrosia_5.png",import.meta.url).href,malortsambrosia_6_png:new URL("./images/malortsambrosia_6.png",import.meta.url).href,"salg_och_viden_-1_png":new URL("./images/salg_och_viden_-1.png",import.meta.url).href,salg_och_viden_0_png:new URL("./images/salg_och_viden_0.png",import.meta.url).href,salg_och_viden_1_png:new URL("./images/salg_och_viden_1.png",import.meta.url).href,salg_och_viden_2_png:new URL("./images/salg_och_viden_2.png",import.meta.url).href,salg_och_viden_3_png:new URL("./images/salg_och_viden_3.png",import.meta.url).href,salg_och_viden_4_png:new URL("./images/salg_och_viden_4.png",import.meta.url).href,salg_och_viden_5_png:new URL("./images/salg_och_viden_5.png",import.meta.url).href,salg_och_viden_6_png:new URL("./images/salg_och_viden_6.png",import.meta.url).href};customElements.define("pollenprognos-card",class extends ie{static get properties(){return{hass:{},config:{}}}static async getConfigElement(){return await customElements.whenDefined("pollenprognos-card-editor"),document.createElement("pollenprognos-card-editor")}static getStubConfig(){return{city:"",allergens:["Al","Alm","Björk","Ek","Malörtsambrosia","Gråbo","Gräs","Hassel","Sälg och viden"],minimal:!1,show_text:!0,show_empty_days:!0,debug:!1,days_to_show:4,days_relative:!0,days_abbreviated:!1,days_uppercase:!1,days_boldfaced:!1,pollen_threshold:1,sort:"value_descending",date_locale:"sv-SE",title:void 0,phrases:{full:{},short:{},levels:[],days:{},no_information:""}}}set hass(e){this._hass=e;const t=Boolean(this.config.debug),s=e=>e.charAt(0).toUpperCase()+e.slice(1),i=e=>{const[t]=e.split("T"),[s,i,a]=t.split("-").map(Number);return new Date(s,i-1,a)},a=e=>e.toLowerCase().replaceAll("å","a").replaceAll("ä","a").replaceAll("ö","o").replaceAll(" / ","_").replaceAll("-","_").replaceAll(" ","_"),r=this.config.phrases||{},n=r.full||{},o=r.short||{},l=r.levels||["Ingen pollen","Låga halter","Låga-måttliga halter","Måttliga halter","Måttliga-höga halter","Höga halter","Mycket höga halter"],h=r.no_information||"(Ingen information)",g=r.days||{},d=this.config.date_locale||"sv-SE";this.days_to_show=this.config.days_to_show??4,this.pollen_threshold=this.config.pollen_threshold??1;const p=!1!==this.config.days_relative,c=Boolean(this.config.days_abbreviated),_=Boolean(this.config.days_uppercase);Boolean(this.config.days_boldfaced);const m=null==this.config.show_empty_days||Boolean(this.config.show_empty_days);"string"==typeof this.config.title?this.header=this.config.title:!1===this.config.title?this.header="":this.header=`Pollenprognos för ${s(this.config.city)}`,t&&console.log("---- pollenprognos-card start ----"),t&&console.log("Stad:",this.config.city),t&&console.log("Allergener från config:",this.config.allergens);const u=[],f=e=>{const t=Number(e);return isNaN(t)||t<0?-1:t>6?6:t},v=new Date;v.setHours(0,0,0,0);for(const t of this.config.allergens)try{const r={};r.allergenReplaced=a(t),r.allergenCapitalized=n[t]||s(t),r.allergenShort=o[t]||r.allergenCapitalized.replace("Sälg och viden","Vide");const $=`sensor.pollen_${a(this.config.city)}_${r.allergenReplaced}`;let y=$;if(!e.states[$]){const t=Object.keys(e.states).filter((e=>e.startsWith("sensor.pollen_")&&e.includes(r.allergenReplaced)));if(1!==t.length)continue;y=t[0]}const w=e.states[y];if(!w?.attributes?.forecast)throw"Saknar forecast";const b=w.attributes.forecast,A=Array.isArray(b)?b.reduce(((e,t)=>(e[t.time||t.datetime]=t,e)),{}):b,U=Object.keys(A).sort(((e,t)=>i(e)-i(t))),k=U.filter((e=>i(e)>=v));let R=k.length?k.slice(0,this.days_to_show):[U[U.length-1]];const L=k.length>0?Math.min(k.length,this.days_to_show):1;if(m)for(;R.length<this.days_to_show;){const e=R.length;r[`day${e}`]={name:r.allergenCapitalized,day:"–",state:-1,state_text:h},R.push(null)}let C=[];if(k.length){if(C=k.slice(0,this.days_to_show),C.length<this.days_to_show){const e=i(C[C.length-1]);for(let t=1;C.length<this.days_to_show;t++){const s=new Date(e.getFullYear(),e.getMonth(),e.getDate()+t),i=s.getFullYear(),a=String(s.getMonth()+1).padStart(2,"0"),r=String(s.getDate()).padStart(2,"0");C.push(`${i}-${a}-${r}T00:00:00`)}}}else{const e=U[U.length-1];C=[e];const t=i(e);for(let e=1;C.length<this.days_to_show;e++){const s=new Date(t.getFullYear(),t.getMonth(),t.getDate()+e),i=s.getFullYear(),a=String(s.getMonth()+1).padStart(2,"0"),r=String(s.getDate()).padStart(2,"0");C.push(`${i}-${a}-${r}T00:00:00`)}}const S=m?this.days_to_show:L;this.displayCols=Array.from({length:S},((e,t)=>t)),C.forEach(((e,t)=>{const a=A[e]||{},n=f(a.level),o=i(e),m=Math.floor((o-v)/864e5);let u;u=p?void 0!==g[m]?g[m]:0===m?"Idag":1===m?"Imorgon":2===m?"I övermorgon":-1===m?"Igår":-2===m?"I förrgår":m<-2?o.toLocaleDateString(d,{day:"numeric",month:"short"}):o.toLocaleDateString(d,{weekday:c?"short":"long"}):o.toLocaleDateString(d,{weekday:c?"short":"long"}),u=s(u),_&&(u=u.toUpperCase()),r[`day${t}`]={name:r.allergenCapitalized,day:u,state:n,state_text:-1===n?h:l[n]??a.level_name}}));let x=0===this.pollen_threshold;for(let e=0;e<L&&!x;e++)r[`day${e}`].state>=this.pollen_threshold&&(x=!0);x&&u.push(r)}catch(e){console.warn(`Fel vid allergen ${t}:`,e)}const $={value_ascending:(e,t)=>e.day0.state-t.day0.state,value_descending:(e,t)=>t.day0.state-e.day0.state,name_descending:(e,t)=>t.allergenCapitalized.localeCompare(e.allergenCapitalized),default:(e,t)=>t.day0.state-e.day0.state};u.sort($[this.config.sort]||$.default),t&&console.log("🧩 Slutliga sensors-array:",u),this.sensors=u}_renderMinimalHtml(){return O`
      <ha-card>
        ${this.header?O`<h1 class="card-header">${this.header}</h1>`:""}
        <div class="flex-container">
          ${this.sensors.map((e=>O`
            <div class="sensor">
              <img class="box"
                src="${re[`${e.allergenReplaced}_${e.day0.state}_png`]??re["0_png"]}"
              />
              ${this.config.show_text?O`<span class="short-text">${e.allergenShort} (${e.day0.state})</span>`:""}
            </div>`))}
        </div>
      </ha-card>
    `}_renderNormalHtml(){const e=Boolean(this.config.days_boldfaced),t=this.displayCols;return O`
      <ha-card>
        ${this.header?O`<h1 class="card-header">${this.header}</h1>`:""}
        <table class="forecast">
          <thead>
            <tr>
              <th></th>
              ${t.map((t=>O`
                <th style="font-weight: ${e?"bold":"normal"}">
                  ${this.sensors[0][`day${t}`].day}
                </th>`))}
            </tr>
          </thead>
          ${this.sensors.map((e=>O`
            <tr class="allergen" valign="top">
              <td>
                <img class="allergen"
                  src="${re[`${e.allergenReplaced}_${e.day0.state}_png`]}"
                />
              </td>
              ${t.map((t=>O`
                <td>
                  <img
                    src="${re[`${e[`day${t}`].state}_png`]??re["0_png"]}"
                  />
                </td>`))}
            </tr>
            ${this.config.show_text?O`
              <tr class="allergen" valign="top">
                <td>${e.allergenCapitalized}</td>
                ${t.map((t=>O`
                  <td><p>${e[`day${t}`].state_text}</p></td>`))}
              </tr>
            `:""}
          `))}
        </table>
      </ha-card>
    `}render(){if(!this.sensors||0===this.sensors.length)return O`
        <ha-card>
          <div class="card-error">
            Inga pollen-sensorer hittades. Har du installerat integrationen
            <a href="https://github.com/JohNan/homeassistant-pollenprognos"
               target="_blank" rel="noopener">
              homeassistant-pollenprognos
            </a>
            och valt en stad?
          </div>
        </ha-card>
      `;return Boolean(this.config.debug)&&console.log(">>> pollenprognos.render:","minimal=",this.config.minimal,"days_to_show=",this.days_to_show,"sensors.length=",this.sensors.length),this.config.minimal?this._renderMinimalHtml():this._renderNormalHtml()}setConfig(e){this.config={city:"",allergens:[],days_to_show:4,pollen_threshold:1,show_empty_days:!0,show_text:!0,minimal:!1,sort:"default",debug:!1,...e},this.images=re}getCardSize(){return this.sensors.length+1}static get styles(){return r`
      .header { padding: 4px 0 12px; @apply --paper-font-headline; color: var(--primary-text-color); }
      .forecast { width:100%; padding:7px; }
      td { padding:1px; text-align:center; width:100px; font-size:smaller; }
      img.allergen { width:40px; height:40px; }
      img { width:50px; height:50px; }
      .flex-container { display:flex; flex-wrap:wrap; justify-content:space-evenly; padding:16px; }
      .sensor { flex:1; min-width:20%; text-align:center; }
      .short-text { display:block; }
      .card-error { padding:16px; color:var(--error-text-color,#b71c1c); font-weight:500; line-height:1.4; }
      .card-error a { color:var(--primary-color); text-decoration:underline; }
    `}});const ne=(e,t)=>{const s={...e};for(const i of Object.keys(t)){const a=t[i];null===a||"object"!=typeof a||Array.isArray(a)||"object"!=typeof e[i]||null===e[i]?s[i]=a:s[i]=ne(e[i],a)}return s};customElements.define("pollenprognos-card-editor",class extends ie{static get properties(){return{_config:{type:Object},hass:{type:Object},installedCities:{type:Array},_initDone:{type:Boolean}}}constructor(){super(),this._config={city:"",allergens:[],days_to_show:4,days_relative:!0,days_abbreviated:!1,days_uppercase:!1,days_boldfaced:!1,minimal:!1,show_text:!1,show_empty_days:!0,pollen_threshold:1,sort:"value_descending",date_locale:"sv-SE",title:void 0,debug:!1,phrases:{full:{},short:{},levels:[],days:{},no_information:""}},this.installedCities=[],this._initDone=!1}setConfig(e){this._config=ne(this._config,e)}set hass(e){this._hass=e;const t=new Set(Object.keys(e.states).filter((e=>e.startsWith("sensor.pollen_"))).map((e=>{const t=e.slice(14);return t.slice(0,t.lastIndexOf("_"))})));this.installedCities=["Borlänge","Bräkne-Hoby","Eskilstuna","Forshaga","Gävle","Göteborg","Hässleholm","Jönköping","Kristianstad","Ljusdal","Malmö","Norrköping","Nässjö","Piteå","Skövde","Stockholm","Storuman","Sundsvall","Umeå","Visby","Västervik","Östersund"].filter((e=>t.has(e.toLowerCase().replace(/[åä]/g,"a").replace(/ö/g,"o").replace(/[-\s]/g,"_")))).sort(((e,t)=>e.localeCompare(t))),this._initDone||this._config.city||!this.installedCities.length||this._updateConfig("city",this.installedCities[0]),this._initDone=!0}get allAllergens(){return["Al","Alm","Björk","Ek","Malörtsambrosia","Gråbo","Gräs","Hassel","Sälg och viden"]}render(){const e=this._config.city||"";return O`
      <div class="card-config">
        <!-- Stad -->
        <ha-formfield label="Stad">
          <ha-select
            style="width:100%"
            .value=${e}
            @selected=${e=>{e.stopPropagation(),this._updateConfig("city",e.target.value)}}
            @closed=${e=>e.stopPropagation()}
          >
            ${this.installedCities.map((e=>O`
              <mwc-list-item .value=${e}>${e}</mwc-list-item>
            `))}
          </ha-select>
        </ha-formfield>

        <!-- Egen titel -->
        <ha-formfield label="Titel (tom = auto)">
          <ha-textfield
            .value=${this._config.title||""}
            placeholder="Ange egen titel eller lämna tom"
            @input=${e=>this._updateConfig("title",e.target.value||void 0)}
          ></ha-textfield>
        </ha-formfield>

        <!-- Layout-switchar -->
        <ha-formfield label="Minimal layout">
          <ha-switch
            .checked=${this._config.minimal}
            @change=${e=>this._updateConfig("minimal",e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="Visa text under ikoner">
          <ha-switch
            .checked=${this._config.show_text}
            @change=${e=>this._updateConfig("show_text",e.target.checked)}
          ></ha-switch>
        </ha-formfield>

        <!-- Veckodagar -->
        <ha-formfield label="Visa tomma dagar">
          <ha-switch
            .checked=${this._config.show_empty_days}
            @change=${e=>this._updateConfig("show_empty_days",e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label='Relativa dagar ("idag" vs veckodag)'>
          <ha-switch
            .checked=${this._config.days_relative}
            @change=${e=>this._updateConfig("days_relative",e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="Förkorta veckodagar (inte relativa)">
          <ha-switch
            .checked=${this._config.days_abbreviated}
            @change=${e=>this._updateConfig("days_abbreviated",e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="Veckodagar i versaler">
          <ha-switch
            .checked=${this._config.days_uppercase}
            @change=${e=>this._updateConfig("days_uppercase",e.target.checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="Veckodagar i fetstil">
          <ha-switch
            .checked=${this._config.days_boldfaced}
            @change=${e=>this._updateConfig("days_boldfaced",e.target.checked)}
          ></ha-switch>
        </ha-formfield>

        <!-- Dagar och tröskel -->
        <ha-formfield label="Antal dagar att visa: ${this._config.days_to_show}">
          <ha-slider
            min="0" max="4" step="1"
            .value=${this._config.days_to_show}
            @change=${e=>this._updateConfig("days_to_show",Number(e.target.value))}
          ></ha-slider>
        </ha-formfield>

        <!-- Allergener -->
        <details>
          <summary>Allergener</summary>
          <div class="allergens-group">
            ${this.allAllergens.map((e=>O`
              <ha-formfield .label=${e}>
                <ha-checkbox
                  .checked=${this._config.allergens.includes(e)}
                  @change=${t=>this._onAllergenToggle(e,t.target.checked)}
                ></ha-checkbox>
              </ha-formfield>
            `))}
          </div>
        </details>

        <ha-formfield label="Tröskelvärde av pollen för visning: ${this._config.pollen_threshold}">
          <ha-slider
            min="0" max="6" step="1"
            .value=${this._config.pollen_threshold}
            @change=${e=>this._updateConfig("pollen_threshold",Number(e.target.value))}
          ></ha-slider>
        </ha-formfield>

        <!-- Sortering -->
        <ha-formfield label="Sorteringsordning för allergener">
          <ha-select
            style="width:100%"
            .value=${this._config.sort}
            @selected=${e=>{e.stopPropagation(),this._updateConfig("sort",e.target.value)}}
            @closed=${e=>e.stopPropagation()}
          >
            ${["value_ascending","value_descending","name_ascending","name_descending"].map((e=>O`
              <mwc-list-item .value=${e}>${e.replace("_"," ")}</mwc-list-item>
            `))}
          </ha-select>
        </ha-formfield>

        <!-- Fraser -->
        <h3>Fraser</h3>
        <ha-formfield label="Locale för veckodagar">
          <ha-textfield
            .value=${this._config.date_locale}
            placeholder="t.ex. sv-SE eller en-GB"
            @input=${e=>this._updateConfig("date_locale",e.target.value)}
          ></ha-textfield>
        </ha-formfield>

        <details>
          <summary>phrases.full (fullständiga namn)</summary>
          ${this.allAllergens.map((e=>O`
            <ha-formfield .label=${e}>
              <ha-textfield
                .value=${this._config.phrases.full[e]||""}
                @input=${t=>{const s={...this._config.phrases};s.full={...s.full,[e]:t.target.value},this._updateConfig("phrases",s)}}
              ></ha-textfield>
            </ha-formfield>
          `))}
        </details>

        <details>
          <summary>phrases.short (kortnamn)</summary>
          ${this.allAllergens.map((e=>O`
            <ha-formfield .label=${e}>
              <ha-textfield
                .value=${this._config.phrases.short[e]||""}
                @input=${t=>{const s={...this._config.phrases};s.short={...s.short,[e]:t.target.value},this._updateConfig("phrases",s)}}
              ></ha-textfield>
            </ha-formfield>
          `))}
        </details>

        <details>
          <summary>phrases.levels (värde 0–6)</summary>
          ${Array.from({length:7},((e,t)=>O`
            <ha-formfield .label=${t}>
              <ha-textfield
                .value=${this._config.phrases.levels[t]||""}
                @input=${e=>{const s={...this._config.phrases},i=[...s.levels||[]];i[t]=e.target.value,s.levels=i,this._updateConfig("phrases",s)}}
              ></ha-textfield>
            </ha-formfield>
          `))}
        </details>

        <ha-formfield label="no_information">
          <ha-textfield
            .value=${this._config.phrases.no_information||""}
            @input=${e=>{const t={...this._config.phrases};t.no_information=e.target.value,this._updateConfig("phrases",t)}}
          ></ha-textfield>
        </ha-formfield>

        <details>
          <summary>phrases.days (0=idag,1=imorgon,2=övermorgon)</summary>
          ${[0,1,2].map((e=>O`
            <ha-formfield .label=${e}>
              <ha-textfield
                .value=${this._config.phrases.days[e]||""}
                @input=${t=>{const s={...this._config.phrases},i={...s.days||{}};i[e]=t.target.value,s.days=i,this._updateConfig("phrases",s)}}
              ></ha-textfield>
            </ha-formfield>
          `))}
        </details>

        <!-- Debug-switch -->
        <ha-formfield label="Debug-läge">
          <ha-switch
            .checked=${this._config.debug}
            @change=${e=>this._updateConfig("debug",e.target.checked)}
          ></ha-switch>
        </ha-formfield>
      </div>
    `}_onAllergenToggle(e,t){const s=new Set(this._config.allergens);t?s.add(e):s.delete(e),this._updateConfig("allergens",[...s])}_updateConfig(e,t){const s={...this._config,[e]:t};this._config=s,this.dispatchEvent(new CustomEvent("config-changed",{detail:{config:s},bubbles:!0,composed:!0}))}static get styles(){return r`
      .card-config { display:flex; flex-direction:column; gap:12px; padding:16px; }
      ha-formfield, details { margin-bottom:8px; }
      .allergens-group { display:flex; flex-wrap:wrap; gap:8px; }
      details summary { cursor:pointer; font-weight:bold; margin:8px 0; }
      ha-slider { width:100%; }
      ha-select { --mdc-theme-primary: var(--primary-color); }
    `}}),window.customCards=window.customCards||[],window.customCards.push({type:"pollenprognos-card",name:"Pollenprognos Card",preview:!0,description:"Visar en grafisk prognos för pollenhalter",documentationURL:"https://github.com/krissen/pollenprognos-card"});
//# sourceMappingURL=pollenprognos-card.js.map
