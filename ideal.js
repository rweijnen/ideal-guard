// ==UserScript==
// @name         iDEAL Bescherming
// @namespace    http://tampermonkey.net/
// @version      1.19
// @description  Blokkeert iDEAL betalingen totdat een vertrouwd persoon op afstand goedkeuring geeft
// @author       jij
// @match        *://pay.ideal.nl/*
// @match        *://ideal.nl/*
// @match        *://*.ideal.nl/*
// @match        *://idealqr.nl/*
// @match        *://ideal.pay.multisafepay.com/*
// @match        *://*.mollie.com/*
// @match        *://*.buckaroo.nl/*
// @match        *://*.adyen.com/*
// @match        *://*.pay.nl/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      ntfy.example.com
// @connect      api.ipify.org
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // INSTELLINGEN
    // ============================================================
    const TIMER_SECONDEN = 600;        // 10 minuten countdown

    // ntfy push: telefoon abonneert op NTFY_TOPIC, script luistert op
    // NTFY_TOPIC + '-resp' (apart topic, zodat de approve/deny callbacks
    // niet als notificatie op je iPhone verschijnen).
    const NTFY_TOPIC = 'YOUR-TOPIC-HERE';
    const NTFY_RESP_TOPIC = NTFY_TOPIC + '-resp';
    const NTFY_HOST = 'https://ntfy.example.com'; // of 'https://ntfy.sh' voor de publieke server
    const NTFY_TOKEN = 'YOUR-PUBLISHER-TOKEN';     // leeg laten voor publieke open topics
    const NTFY_AUTH = NTFY_TOKEN ? 'Bearer ' + NTFY_TOKEN : '';

    function withAuth(extra) {
        const h = Object.assign({}, extra || {});
        if (NTFY_AUTH) h.Authorization = NTFY_AUTH;
        return h;
    }
    // ============================================================

    // ── Stijlen (iDEAL look & feel) ──────────────────────────────
    const IDEAL_PINK = '#CC0066';
    const stijl = document.createElement('style');
    stijl.textContent = `
        #ideal-blokkeer-overlay {
            position: fixed;
            inset: 0;
            background: #f5f5f5;
            z-index: 2147483647;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            overflow-y: auto;
        }
        #ideal-header {
            width: 100%;
            background: #fff;
            border-bottom: 1px solid #e0e0e0;
            padding: 16px 24px;
            display: flex;
            align-items: center;
            justify-content: flex-start;
        }
        #ideal-header svg {
            height: 36px;
        }
        #ideal-blokkeer-kaart {
            background: #fff;
            border-radius: 12px;
            padding: 40px 48px;
            max-width: 560px;
            width: 90%;
            text-align: center;
            box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            margin: 48px 0;
        }
        #ideal-blokkeer-kaart h1 {
            color: #1d1c1c;
            font-size: 24px;
            font-weight: 700;
            margin: 0 0 16px;
            line-height: 1.3;
        }
        #ideal-blokkeer-kaart p {
            color: #444;
            font-size: 16px;
            line-height: 1.6;
            margin: 0 0 20px;
        }
        #ideal-betaal-info {
            background: #fafafa;
            border: 1px solid #eee;
            border-radius: 8px;
            padding: 16px 20px;
            margin: 0 0 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            text-align: left;
        }
        #ideal-betaal-info .label {
            color: #888;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        #ideal-betaal-info .merchant {
            color: #1d1c1c;
            font-size: 18px;
            font-weight: 600;
            margin-top: 2px;
        }
        #ideal-betaal-info .bedrag {
            color: ${IDEAL_PINK};
            font-size: 24px;
            font-weight: 700;
        }
        #ideal-timer-ring {
            width: 140px;
            height: 140px;
            margin: 8px auto 24px;
            position: relative;
        }
        #ideal-timer-ring svg { transform: rotate(-90deg); }
        #ideal-timer-ring .ring-bg {
            fill: none;
            stroke: #f0f0f0;
            stroke-width: 8;
        }
        #ideal-timer-ring .ring-fg {
            fill: none;
            stroke: ${IDEAL_PINK};
            stroke-width: 8;
            stroke-linecap: round;
            transition: stroke-dashoffset 1s linear;
        }
        #ideal-timer-getal {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 38px;
            font-weight: 700;
            color: ${IDEAL_PINK};
        }
        #ideal-push-info {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            background: #fdf2f7;
            border: 1px solid #f5d6e3;
            color: #6e0035;
            border-radius: 8px;
            padding: 12px 16px;
            font-size: 14px;
            margin: 0 0 24px;
        }
        #ideal-push-info .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: ${IDEAL_PINK};
            animation: ideal-pulse 1.4s infinite;
        }
        @keyframes ideal-pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.4; transform: scale(0.8); }
        }
        #ideal-ga-verder {
            display: none;
            background: ${IDEAL_PINK};
            color: #fff;
            border: none;
            border-radius: 24px;
            font-size: 16px;
            font-weight: 600;
            padding: 14px 32px;
            cursor: pointer;
            width: 100%;
            margin-top: 8px;
        }
        #ideal-ga-verder:hover { background: #a30052; }
    `;

    const OMTREK = 2 * Math.PI * 54;

    // ── HTML opbouwen ─────────────────────────────────────────────
    const IDEAL_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 106 40" aria-label="iDEAL"><g><path fill="#CC0066" d="M14.188 9.775v22.152h9.682c8.793 0 12.604-4.945 12.604-11.936 0-6.992-3.814-11.884-12.604-11.884h-8.006c-.929 0-1.676.756-1.676 1.67z"/><path fill="#1d1c1c" fill-rule="evenodd" d="M7.112 35.226h15.644c10.994 0 17.06-5.413 17.06-15.238 0-5.661-2.215-15.171-17.06-15.171H7.112a2.51 2.51 0 0 0-2.516 2.505v25.4a2.51 2.51 0 0 0 2.516 2.506zM5.433 7.322c0-.925.747-1.67 1.677-1.67h15.644c6.053 0 16.22 1.866 16.22 14.336 0 9.288-5.764 14.403-16.22 14.403H7.112c-.93 0-1.677-.743-1.677-1.67V7.321z" clip-rule="evenodd"/><path fill="#fff" fill-rule="evenodd" d="M18.951 16.769a2.7 2.7 0 0 0-.936-.159v-.013H15.8v5.35h2.243c.397 0 .742-.08 1.039-.211.294-.145.538-.33.731-.567.194-.238.334-.528.435-.858.09-.33.141-.685.141-1.08 0-.45-.064-.832-.18-1.161a2.7 2.7 0 0 0-.499-.818 2.1 2.1 0 0 0-.756-.488zm-.525 4.125c-.167.053-.32.079-.488.079v.013h-1.012v-3.373h.82c.28 0 .511.04.704.118.194.08.347.211.462.356a1.5 1.5 0 0 1 .257.554c.05.211.077.462.077.725 0 .304-.04.541-.115.752s-.18.37-.294.501a.95.95 0 0 1-.41.277z" clip-rule="evenodd"/><path fill="#fff" d="M25.015 16.613v.989H22.27v1.147h2.524v.91h-2.524v1.305h2.808v.99H21.13v-5.35h3.884v.013z"/><path fill="#fff" fill-rule="evenodd" d="m30.885 21.962-1.949-5.35h-1.19l-1.962 5.35h1.153l.41-1.187h1.95l.397 1.187h1.193zm-2.54-4.033L29 19.892h-1.344l.678-1.963h.014z" clip-rule="evenodd"/><path fill="#fff" d="M32.744 16.61v4.363h2.537v.989h-3.677v-5.35h1.14z"/><path fill="#1d1c1c" d="M9.689 22.041a2.514 2.514 0 0 0 2.513-2.516 2.514 2.514 0 1 0-5.026 0 2.514 2.514 0 0 0 2.513 2.516M11.185 32.105c-1.947 0-3.507-1.681-3.507-3.747v-2.926c0-1.033.78-1.881 1.76-1.881s1.76.835 1.76 1.881v6.673z"/></g></svg>';

    const omgeving = document.createElement('div');
    omgeving.id = 'ideal-blokkeer-overlay';

    const header = document.createElement('div');
    header.id = 'ideal-header';
    header.innerHTML = IDEAL_LOGO_SVG;
    omgeving.appendChild(header);

    const kaart = document.createElement('div');
    kaart.id = 'ideal-blokkeer-kaart';
    kaart.innerHTML = `
        <h1>Let op, u staat op het punt een betaling te doen via iDEAL.</h1>
        <p>Wij controleren nu of dit veilig is, dit kan enige tijd duren.</p>

        <div id="ideal-betaal-info" style="display:none;">
            <div>
                <div class="label">Betaling aan</div>
                <div class="merchant" id="ideal-merchant">—</div>
            </div>
            <div class="bedrag" id="ideal-bedrag">—</div>
        </div>

        <div id="ideal-timer-ring">
            <svg width="140" height="140" viewBox="0 0 140 140">
                <circle class="ring-bg" cx="70" cy="70" r="54"/>
                <circle class="ring-fg" id="ideal-ring-fg"
                    cx="70" cy="70" r="54"
                    stroke-dasharray="${OMTREK}"
                    stroke-dashoffset="0"/>
            </svg>
            <div id="ideal-timer-getal">10:00</div>
        </div>

    `;
    omgeving.appendChild(kaart);

    // Wacht tot body beschikbaar is
    function plaatsOverlay() {
        if (document.getElementById('ideal-blokkeer-overlay')) return;
        (document.head || document.documentElement).appendChild(stijl);
        (document.body || document.documentElement).appendChild(omgeving);

        const ringFg = document.getElementById('ideal-ring-fg');
        const timerGetal = document.getElementById('ideal-timer-getal');

        let secOver = TIMER_SECONDEN;

        function formatMMSS(s) {
            const m = Math.floor(s / 60);
            const r = s % 60;
            return m + ':' + (r < 10 ? '0' + r : r);
        }

        timerGetal.textContent = formatMMSS(secOver);
        ringFg.style.strokeDashoffset = '0';

        function updateTimer() {
            secOver--;
            const voortgang = Math.max(secOver, 0) / TIMER_SECONDEN;
            ringFg.style.strokeDashoffset = String(OMTREK * (1 - voortgang));

            if (secOver <= 0) {
                timerGetal.textContent = '…';
                ringFg.style.stroke = '#888';
                clearInterval(interval);
                // Géén auto-doorgang. Wacht op goedkeuring via push.
                return;
            }
            timerGetal.textContent = formatMMSS(secOver);
        }

        const interval = setInterval(updateTimer, 1000);

        // Push naar iPhone met approve/deny knoppen
        startNtfyFlow();
    }

    // ── ntfy.sh push + remote approve/deny ───────────────────────
    // CSP van pay.ideal.nl blokkeert fetch en EventSource naar externe
    // hosts; daarom alles via GM_xmlhttpRequest (draait in TM-context).
    let pushVerzonden = false;
    let pollTimer = null;
    let sindsTs = Math.floor(Date.now() / 1000);
    // Uniek ID per pagina-load zodat goedkeuringen voor andere tabs/sessies
    // niet onbedoeld dit overlay-instance ontgrendelen.
    const aanvraagId = Date.now().toString(36) + '-' +
        Math.random().toString(36).slice(2, 8);

    // Haal publiek IP op (best-effort, voor in de push-melding)
    let publiekeIp = null;
    GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://api.ipify.org?format=json',
        onload: r => {
            try { publiekeIp = JSON.parse(r.responseText).ip; }
            catch (e) { /* negeer */ }
        }
    });

    function leesReferrer() {
        try {
            if (document.referrer) return new URL(document.referrer).hostname;
        } catch (e) { /* */ }
        return null;
    }

    function nuFormatted() {
        const d = new Date();
        return d.toLocaleString('nl-NL', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function leesPaginaData() {
        const mEl = document.querySelector('[data-testid="payment-amount-creditor"]');
        const aEl = document.querySelector('[data-testid="payment-amount"]');
        let merchant = mEl ? mEl.textContent.trim() : null;
        let bedrag = null;
        if (aEl) {
            bedrag = aEl.getAttribute('aria-label') || aEl.textContent.trim();
        } else {
            // Fallback: regex op page-tekst (voor non-iDEAL PSPs)
            const txt = (document.body && document.body.innerText) || '';
            const m = txt.match(/€\s*([\d]+(?:[.,]\d{2})?)/);
            if (m) bedrag = '€' + m[1];
        }
        if (!merchant) {
            const titel = (document.title || '').replace(/\s*[-|·]\s*iDEAL.*/i, '').trim();
            if (titel && !/^iDEAL/i.test(titel)) merchant = titel;
            else if (document.referrer) {
                try { merchant = new URL(document.referrer).hostname; } catch (e) { /* */ }
            }
            if (!merchant) merchant = location.hostname;
        }
        return { merchant, bedrag };
    }

    function updateOverlayInfo(merchant, bedrag) {
        const info = document.getElementById('ideal-betaal-info');
        const mNode = document.getElementById('ideal-merchant');
        const bNode = document.getElementById('ideal-bedrag');
        if (!info || !mNode || !bNode) return;
        if (merchant) mNode.textContent = merchant;
        if (bedrag) bNode.textContent = bedrag;
        if (merchant || bedrag) info.style.display = 'flex';
    }

    function stuurPush(merchant, bedrag) {
        const ref = leesReferrer();
        const regels = [
            merchant,
            'Tijdstip: ' + nuFormatted(),
            'IP: ' + (publiekeIp || 'onbekend')
        ];
        if (ref) regels.push('Vanaf: ' + ref);
        regels.push('', 'Goedkeuren of afkeuren?');

        const body = {
            topic: NTFY_TOPIC,
            title: 'iDEAL betaling: ' + bedrag,
            message: regels.join('\n'),
            priority: 4,
            actions: [
                { action: 'http', label: '✅ Goedkeuren',
                  url: NTFY_HOST + '/' + NTFY_RESP_TOPIC,
                  method: 'POST', body: 'approve:' + aanvraagId, clear: true,
                  headers: withAuth() },
                { action: 'http', label: '❌ Afkeuren',
                  url: NTFY_HOST + '/' + NTFY_RESP_TOPIC,
                  method: 'POST', body: 'deny:' + aanvraagId, clear: true,
                  headers: withAuth() }
            ]
        };
        GM_xmlhttpRequest({
            method: 'POST',
            url: NTFY_HOST,
            headers: withAuth({ 'Content-Type': 'application/json' }),
            data: JSON.stringify(body),
            onerror: err => console.warn('[iDEAL] ntfy publish faalde:', err)
        });
    }

    function luisterOpAntwoord() {
        if (pollTimer) return;
        const url = NTFY_HOST + '/' + NTFY_RESP_TOPIC + '/json';
        const poll = () => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url + '?poll=1&since=' + sindsTs,
                headers: withAuth(),
                onload: function (resp) {
                    // ntfy /json levert één JSON-object per regel
                    const regels = (resp.responseText || '').split('\n').filter(Boolean);
                    for (const r of regels) {
                        try {
                            const d = JSON.parse(r);
                            if (d.event !== 'message') continue;
                            if (d.time) sindsTs = Math.max(sindsTs, d.time + 1);
                            const m = (d.message || '').trim().toLowerCase();
                            // Verwacht formaat "approve:<id>" of "deny:<id>".
                            // Negeer responses voor andere aanvragen.
                            const idx = m.indexOf(':');
                            if (idx < 0) continue;
                            const actie = m.slice(0, idx);
                            const id = m.slice(idx + 1);
                            if (id !== aanvraagId.toLowerCase()) continue;
                            if (actie === 'approve') { goedkeur(); return; }
                            if (actie === 'deny') { afkeur(); return; }
                        } catch (e) { /* negeer kapotte regel */ }
                    }
                },
                onerror: err => console.warn('[iDEAL] ntfy poll faalde:', err)
            });
        };
        pollTimer = setInterval(poll, 2000);
        poll();
    }

    function stopPoll() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function goedkeur() {
        omgeving.remove();
        stijl.remove();
        stopPoll();
        obs.disconnect();
    }

    function afkeur() {
        stopPoll();

        // Vervang de hele kaart door een opvallende fraude-waarschuwing.
        // We sturen NIET terug naar de webshop; daar zou alsnog op een andere
        // manier betaald kunnen worden. Tabblad moet handmatig gesloten worden.
        const kaartEl = document.getElementById('ideal-blokkeer-kaart');
        if (kaartEl) {
            kaartEl.style.borderTop = '8px solid #c0392b';
            kaartEl.innerHTML = `
                <div style="font-size:64px; line-height:1; margin:0 0 16px;">⚠️</div>
                <h1 style="color:#c0392b; font-size:26px; margin:0 0 16px;">
                    Deze betaling is afgewezen
                </h1>
                <p style="font-size:17px; color:#222; line-height:1.6; margin:0 0 16px;">
                    <strong>Let op:</strong> deze betaling is geblokkeerd omdat
                    er mogelijk sprake is van fraude.
                </p>
                <p style="font-size:16px; color:#444; line-height:1.6; margin:0 0 16px;">
                    Voer deze betaling <strong>niet</strong> opnieuw uit. Sluit
                    deze pagina en neem contact op met uw familie als u twijfelt.
                </p>
                <p style="font-size:13px; color:#888; margin:0;">
                    Tijdstip: ${nuFormatted()}
                </p>
            `;
        }

        // We klikken bewust NIET op iDEAL's eigen Cancel-knop. Die zou een
        // server-side annulering doen en daarna terug-redirecten naar de
        // webshop, waar alsnog op andere wijze betaald zou kunnen worden.
        // De iDEAL-transactie verloopt vanzelf na de server-side timeout.
        // De fraude-waarschuwing blijft staan tot de gebruiker het tabblad
        // bewust sluit.

        // Voorkom voor zover mogelijk dat de pagina zelf nog navigeert
        // (bv. door een nog uitstaande XHR die alsnog redirect).
        try {
            const blokkeer = () => {};
            window.location.assign = blokkeer;
            window.location.replace = blokkeer;
        } catch (e) { /* sommige browsers laten dit niet toe */ }
        window.addEventListener('beforeunload', e => {
            e.preventDefault();
            e.returnValue = '';
        });
    }

    function probeerPush(forceer) {
        if (pushVerzonden) return;
        const data = leesPaginaData();
        updateOverlayInfo(data.merchant, data.bedrag);
        if (!forceer && !data.bedrag) return; // wacht op data
        pushVerzonden = true;
        stuurPush(data.merchant || location.hostname,
                  data.bedrag || '(bedrag onbekend)');
    }

    function startNtfyFlow() {
        luisterOpAntwoord();
        // Lichte poll i.p.v. MutationObserver op subtree (te duur in een
        // React SPA, vuurt continu). Stopt zodra push verzonden is, anders
        // forceert na 3s alsnog met wat we hebben.
        probeerPush();
        let pogingen = 0;
        const tik = setInterval(() => {
            probeerPush();
            if (pushVerzonden || ++pogingen > 12) {
                clearInterval(tik);
                if (!pushVerzonden) probeerPush(true);
            }
        }, 250);
    }

    // Plaats meteen op documentElement (document-start), en herplaats als de
    // HTML-parser de DOM nog opbouwt en onze knooppunten zou wegvegen.
    plaatsOverlay();

    // Tijdens de initial parse kan de HTML-parser onze knooppunten wegvegen.
    // Daarna niet meer nodig — uit zetten zodra DOM klaar is, anders vuurt
    // 'ie continu mee met React renders en wordt de pagina onresponsief.
    const obs = new MutationObserver(() => {
        if (!document.getElementById('ideal-blokkeer-overlay')) {
            plaatsOverlay();
        }
    });
    obs.observe(document.documentElement, { childList: true });

    function stopParserObs() {
        obs.disconnect();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            plaatsOverlay();
            setTimeout(stopParserObs, 500);
        });
    } else {
        setTimeout(stopParserObs, 500);
    }

})();