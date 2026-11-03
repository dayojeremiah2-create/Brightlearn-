"use strict";

/*
 * Bright Learn front-end behavior.
 * Replace GOOGLE_CLIENT_ID with a Web application OAuth client ID to enable Google sign-in.
 * Change WHATSAPP_NUMBER to update the click-to-chat destination (digits only, country code first).
 * This local-only demo is not a substitute for secure server-side accounts or child-data storage.
 */
const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID";
const WHATSAPP_NUMBER = "2349156496252";
const ACCOUNTS_KEY = "brightLearn.accounts.v1";
const PROGRESS_KEY = "brightLearn.progress.v1";
const ENCOURAGEMENT_DELAY = 5 * 60 * 1000;
const INTRO_DELAY = 1.5 * 1000;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const coverIds = [
	"splash-page",
	"account-page",
	"profile-page",
	"age-page",
	"welcome-page",
	"activities-page",
	"games-page",
	"quiz-page",
	"puzzle-page"
];
const covers = coverIds.map((id) => document.getElementById(id)).filter(Boolean);

let activeCover = $("#splash-page");
let learner = null;
let pendingGoogleProfile = null;
let activeGame = null;
let activeQuiz = null;
let puzzleState = null;
let activityTimerId = null;
let activityTimeLeft = ENCOURAGEMENT_DELAY;
let timerActivity = false;
let timerPausedForDialog = false;
let toastTimeoutId = null;
let transitionNumber = 0;
let introTimeoutId = null;

function showToast(message) {
	const toast = $("#toast-message");
	if (!toast) return;
	toast.textContent = message;
	toast.hidden = false;
	clearTimeout(toastTimeoutId);
	toastTimeoutId = window.setTimeout(() => {
		toast.hidden = true;
	}, 4200);
}

function setCover(pageId) {
	const nextCover = document.getElementById(pageId);
	if (!nextCover) return;
	if (activeCover === nextCover && !nextCover.hidden) return;
	const previousCover = activeCover;
	const moveNumber = ++transitionNumber;
	stopActivityTimer();
	activeCover = nextCover;
	document.body.dataset.page = pageId;
	$("#learner-avatar").hidden = !learner;

	if (!previousCover || previousCover === nextCover || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		covers.forEach((cover) => { cover.hidden = cover !== nextCover; });
		return;
	}

	nextCover.hidden = false;
	if (previousCover.id === "splash-page" && nextCover.id === "account-page") {
		nextCover.animate(
			[{ transform: "translateY(100%)" }, { transform: "translateY(0)" }],
			{ duration: 720, easing: "cubic-bezier(.76,0,.24,1)" }
		);
		previousCover.animate(
			[{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }],
			{ duration: 720, easing: "cubic-bezier(.76,0,.24,1)" }
		).onfinish = () => {
			if (moveNumber === transitionNumber) {
				covers.forEach((cover) => { cover.hidden = cover !== nextCover; });
			}
		};
		return;
	}

	nextCover.animate(
		[{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "translateY(0)" }],
		{ duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" }
	);
	previousCover.animate(
		[{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-18px)" }],
		{ duration: 300, easing: "ease-in" }
	).onfinish = () => {
		if (moveNumber === transitionNumber) {
			covers.forEach((cover) => { cover.hidden = cover !== nextCover; });
		}
	};
}

function openAccountCover() {
	clearTimeout(introTimeoutId);
	introTimeoutId = null;
	setCover("account-page");
}

function startIntroTimer() {
	clearTimeout(introTimeoutId);
	introTimeoutId = window.setTimeout(openAccountCover, INTRO_DELAY);
}

function setAuthMode(mode) {
	const isSignup = mode === "signup";
	$("#signup-panel").hidden = !isSignup;
	$("#signin-panel").hidden = isSignup;
	$("#signup-tab").classList.toggle("is-active", isSignup);
	$("#signin-tab").classList.toggle("is-active", !isSignup);
	$("#signup-tab").setAttribute("aria-selected", String(isSignup));
	$("#signin-tab").setAttribute("aria-selected", String(!isSignup));
}

function readAccounts() {
	try {
		const accounts = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "{}");
		return accounts && typeof accounts === "object" ? accounts : {};
	} catch {
		return {};
	}
}

function writeAccounts(accounts) {
	localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function normalizeEmail(email) {
	return String(email || "").trim().toLowerCase();
}

function deriveAgeRange(age) {
	const numericAge = Number(age);
	if (numericAge <= 5) return "3-5";
	if (numericAge <= 8) return "6-8";
	if (numericAge <= 12) return "9-12";
	return "13-19";
}

function getProgress() {
	try {
		const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
		return progress && typeof progress === "object" ? progress : {};
	} catch {
		return {};
	}
}

function saveProgress(progress) {
	if (!learner) return;
	const allProgress = getProgress();
	allProgress[normalizeEmail(learner.email)] = progress;
	localStorage.setItem(PROGRESS_KEY, JSON.stringify(allProgress));
}

function getLearnerProgress() {
	const allProgress = getProgress();
	const saved = allProgress[normalizeEmail(learner?.email)] || {};
	return {
		stars: Number(saved.stars) || 0,
		unlockedLevel: Math.max(1, Number(saved.unlockedLevel) || 1),
		quizBest: Number(saved.quizBest) || 0,
		puzzlesSolved: Number(saved.puzzlesSolved) || 0
	};
}

function updateLearner(profile) {
	learner = {
		...profile,
		email: normalizeEmail(profile.email),
		age: Number(profile.age),
		ageRange: profile.ageRange || deriveAgeRange(profile.age)
	};
	$("#welcome-name").textContent = learner.name;
	$("#avatar-name").textContent = learner.name;
	$("#avatar-face").textContent = learner.name.charAt(0).toUpperCase();
	$("#learner-avatar").dataset.gender = learner.gender;
	$("#learner-avatar").hidden = false;
	$("#activity-level-label").textContent = `Level ${learner.ageRange} · personalized for you`;
	$$("[data-age-range]").forEach((card) => {
		const selected = card.dataset.ageRange === learner.ageRange;
		card.classList.toggle("is-selected", selected);
		card.setAttribute("aria-pressed", String(selected));
	});
}

function getSalt() {
	const salt = new Uint8Array(16);
	window.crypto.getRandomValues(salt);
	return salt;
}

async function hashPin(pin, saltBytes) {
	if (!window.crypto?.subtle) {
		throw new Error("Secure password storage needs a modern browser on localhost or HTTPS.");
	}
	const salt = saltBytes || getSalt();
	const keyMaterial = await window.crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(pin),
		"PBKDF2",
		false,
		["deriveBits"]
	);
	const bits = await window.crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
		keyMaterial,
		256
	);
	return {
		salt: Array.from(salt),
		hash: Array.from(new Uint8Array(bits))
	};
}

function sameBytes(first, second) {
	if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) return false;
	let difference = 0;
	for (let index = 0; index < first.length; index += 1) difference |= first[index] ^ second[index];
	return difference === 0;
}

function whatsappAlertUrl(profile) {
	const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date());
	const message = `Bright Learn sign-in alert\nName: ${profile.name}\nEmail: ${profile.email}\nTime: ${time}`;
	return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

function showWhatsAppDraftLink(profile) {
	if (!profile.whatsappAlertsConsent) return;
	const toast = $("#toast-message");
	if (!toast) return;
	const link = document.createElement("a");
	link.href = whatsappAlertUrl(profile);
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	link.textContent = "Open WhatsApp message";
	toast.replaceChildren(document.createTextNode("Sign-in successful. Send the notice: "), link);
	toast.hidden = false;
	clearTimeout(toastTimeoutId);
	toastTimeoutId = window.setTimeout(() => { toast.hidden = true; }, 10000);
}

function openWhatsAppDraft(profile) {
	if (!profile.whatsappAlertsConsent) return;
	const popup = window.open(whatsappAlertUrl(profile), "_blank");
	if (popup) {
		popup.opener = null;
		return;
	}
	showWhatsAppDraftLink(profile);
}

function finishSignIn(profile) {
	updateLearner(profile);
	setCover("age-page");
	$$("[data-age-range]").forEach((card) => {
		const selected = card.dataset.ageRange === learner.ageRange;
		card.classList.toggle("is-selected", selected);
		card.setAttribute("aria-pressed", String(selected));
	});
}

function beginActivityTimer() {
	stopActivityTimer();
	timerActivity = true;
	timerPausedForDialog = false;
	activityTimeLeft = ENCOURAGEMENT_DELAY;
	scheduleActivityTick();
}

function stopActivityTimer() {
	clearInterval(activityTimerId);
	activityTimerId = null;
	timerActivity = false;
	timerPausedForDialog = false;
}

function scheduleActivityTick() {
	clearInterval(activityTimerId);
	if (!timerActivity || timerPausedForDialog || document.hidden) return;
	activityTimerId = window.setInterval(() => {
		activityTimeLeft -= 1000;
		if (activityTimeLeft <= 0) showEncouragement();
	}, 1000);
}

const encouragements = [
	"Good work, {name}. Your steady practice is paying off.",
	"Nice progress, {name}. Take a moment to notice how far you've come.",
	"Your focus is making a difference, {name}. Keep going at your own pace.",
	"Well done, {name}. Each focused attempt builds a stronger skill."
];

function showEncouragement() {
	clearInterval(activityTimerId);
	activityTimerId = null;
	timerPausedForDialog = true;
	const message = encouragements[Math.floor(Math.random() * encouragements.length)];
	$("#encouragement-message").textContent = message.replace("{name}", learner?.name || "friend");
	const dialog = $("#encouragement-dialog");
	if (!dialog.open) dialog.showModal();
}

function resumeActivityTimer() {
	if (!timerActivity || !timerPausedForDialog) return;
	timerPausedForDialog = false;
	activityTimeLeft = ENCOURAGEMENT_DELAY;
	scheduleActivityTick();
}

function showAgeCoverForProfile(profile) {
	updateLearner(profile);
	setCover("age-page");
}

function handleSignup(event) {
	event.preventDefault();
	const formData = new FormData(event.currentTarget);
	const profile = {
		name: String(formData.get("name") || "").trim(),
		email: normalizeEmail(formData.get("email")),
		gender: String(formData.get("gender") || ""),
		age: Number(formData.get("age")),
		guardianPhone: String(formData.get("guardianPhone") || "").trim(),
		whatsappAlertsConsent: formData.get("whatsappAlerts") === "on"
	};
	const pin = String(formData.get("pin") || "");
	if (!profile.name || !profile.email || !profile.guardianPhone || !["Male", "Female"].includes(profile.gender)) return;
	if (profile.age < 3 || profile.age > 19) {
		showToast("Please enter an age from 3 to 19.");
		return;
	}
	if (readAccounts()[profile.email]) {
		showToast("An account already uses that email. Choose Sign in instead.");
		return;
	}

	const chatWindow = profile.whatsappAlertsConsent ? window.open("about:blank", "_blank") : null;
	if (chatWindow) chatWindow.opener = null;
	hashPin(pin).then((credential) => {
		const accounts = readAccounts();
		if (accounts[profile.email]) {
			chatWindow?.close();
			showToast("An account already uses that email. Choose Sign in instead.");
			return;
		}
		profile.ageRange = deriveAgeRange(profile.age);
		accounts[profile.email] = { profile, credential };
		writeAccounts(accounts);
		updateLearner(profile);
		setCover("age-page");
		if (profile.whatsappAlertsConsent) {
			if (chatWindow) chatWindow.location.replace(whatsappAlertUrl(profile));
			else showWhatsAppDraftLink(profile);
		}
	}).catch((error) => {
		chatWindow?.close();
		showToast(error.message || "This browser could not create your account.");
	});
}

function handleSignin(event) {
	event.preventDefault();
	const formData = new FormData(event.currentTarget);
	const email = normalizeEmail(formData.get("email"));
	const pin = String(formData.get("pin") || "");
	const whatsappAlertsConsent = formData.get("whatsappAlerts") === "on";
	const account = readAccounts()[email];
	if (!account?.credential || !account.profile) {
		showToast("We couldn't find that account on this device. Check the email or sign up here.");
		return;
	}
	const chatWindow = whatsappAlertsConsent ? window.open("about:blank", "_blank") : null;
	if (chatWindow) chatWindow.opener = null;
	hashPin(pin, new Uint8Array(account.credential.salt)).then((candidate) => {
		if (!sameBytes(candidate.hash, account.credential.hash)) {
			chatWindow?.close();
			showToast("That password or PIN doesn't match. Please try again.");
			return;
		}
		account.profile.whatsappAlertsConsent = whatsappAlertsConsent;
		const accounts = readAccounts();
		accounts[email] = account;
		try { writeAccounts(accounts); } catch { showToast("Your notification preference could not be saved."); }
		finishSignIn(account.profile);
		if (whatsappAlertsConsent) {
			if (chatWindow) chatWindow.location.replace(whatsappAlertUrl(account.profile));
			else showWhatsAppDraftLink(account.profile);
		}
	}).catch((error) => {
		chatWindow?.close();
		showToast(error.message || "This browser could not check your sign-in.");
	});
}

function decodeGoogleCredential(token) {
	const payload = token.split(".")[1];
	if (!payload) throw new Error("Google did not return a valid sign-in.");
	const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
	const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
	const binary = window.atob(paddedBase64);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return JSON.parse(new TextDecoder().decode(bytes));
}

function handleGoogleCredential(response) {
	try {
		const googleUser = decodeGoogleCredential(response.credential);
		if (!googleUser.email || !googleUser.name) throw new Error("Google did not provide a name and email.");
		const email = normalizeEmail(googleUser.email);
		const account = readAccounts()[email];
		if (account?.profile) {
			finishSignIn(account.profile);
			openWhatsAppDraft(account.profile);
			return;
		}
		pendingGoogleProfile = { name: String(googleUser.name).slice(0, 60), email };
		setCover("profile-page");
	} catch (error) {
		showToast(error.message || "Google sign-in did not finish. Please try again.");
	}
}

function setupGoogleSignIn() {
	const mount = $("#google-signin-button");
	if (!mount) return;
	mount.replaceChildren();
	const googleReady = window.google?.accounts?.id;
	const hasClientId = GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID !== "YOUR_GOOGLE_CLIENT_ID";

	if (googleReady && hasClientId) {
		googleReady.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
		googleReady.renderButton(mount, { type: "standard", theme: "filled_blue", size: "large", text: "continue_with", shape: "pill", width: 320 });
		return true;
	}

	const button = document.createElement("button");
	button.type = "button";
	button.className = "button button--google";
	button.innerHTML = `<svg class="google-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11c-.5 2.5-2 4.7-4.3 6.1l6.8 5.3c4-3.7 6.1-9 6.1-15.1z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.8-5.3c-1.9 1.3-4.3 2-6.7 2-5.2 0-9.6-3.5-11.2-8.2l-7 5.4C9.2 39.9 16.1 44 24 44z"/><path fill="#FBBC05" d="M12.8 27.6a12 12 0 0 1 0-7.2l-7-5.4a20 20 0 0 0 0 18z"/><path fill="#EA4335" d="M24 9.5c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 3.2 29.5 1 24 1 16.1 1 9.2 5.1 5.8 11l7 5.4c1.6-4 5.9-6.9 11.2-6.9z"/></svg><span>Continue with Google</span>`;
	button.addEventListener("click", () => {
		showToast(hasClientId ? "Google sign-in is still loading. Please try again." : "To enable Google sign-in, add your OAuth Client ID at the top of script.js.");
	});
	mount.append(button);
	return false;
}

const gameSets = {
	"3-5": [
		[{ prompt: "How many are 1 apple and 1 more apple?", options: ["1", "2", "3"], answer: "2" }, { prompt: "Which number comes after 2?", options: ["1", "3", "5"], answer: "3" }, { prompt: "How many are 2 ducks and 1 more duck?", options: ["2", "3", "4"], answer: "3" }],
		[{ prompt: "Which one is a color?", options: ["Blue", "Table", "Jump"], answer: "Blue" }, { prompt: "Which animal says 'meow'?", options: ["Cow", "Cat", "Duck"], answer: "Cat" }, { prompt: "Which one is a fruit?", options: ["Apple", "Shoe", "Chair"], answer: "Apple" }],
		[{ prompt: "What shape has three sides?", options: ["Circle", "Triangle", "Square"], answer: "Triangle" }, { prompt: "Which is the biggest number?", options: ["2", "5", "1"], answer: "5" }, { prompt: "What do we use to see?", options: ["Eyes", "Ears", "Hands"], answer: "Eyes" }]
	],
	"6-8": [
		[{ prompt: "What is 4 + 3?", options: ["6", "7", "8"], answer: "7" }, { prompt: "What is 10 - 4?", options: ["5", "6", "7"], answer: "6" }, { prompt: "What is 2 + 5?", options: ["7", "8", "9"], answer: "7" }],
		[{ prompt: "Which word rhymes with 'cake'?", options: ["Bike", "Lake", "Book"], answer: "Lake" }, { prompt: "What is the opposite of 'hot'?", options: ["Cold", "Warm", "Bright"], answer: "Cold" }, { prompt: "Which word names a place?", options: ["School", "Quickly", "Soft"], answer: "School" }],
		[{ prompt: "Which planet do we live on?", options: ["Mars", "Earth", "Venus"], answer: "Earth" }, { prompt: "How many days are in a week?", options: ["5", "7", "10"], answer: "7" }, { prompt: "Which animal is a mammal?", options: ["Frog", "Dolphin", "Butterfly"], answer: "Dolphin" }]
	],
	"9-12": [
		[{ prompt: "What is 9 × 6?", options: ["45", "54", "63"], answer: "54" }, { prompt: "What is 72 ÷ 8?", options: ["8", "9", "10"], answer: "9" }, { prompt: "What is 15 + 28?", options: ["43", "42", "44"], answer: "43" }],
		[{ prompt: "Which word is closest in meaning to 'enormous'?", options: ["Tiny", "Huge", "Quiet"], answer: "Huge" }, { prompt: "What is the plural of 'child'?", options: ["Childs", "Children", "Childes"], answer: "Children" }, { prompt: "Which is a verb?", options: ["Carefully", "Bright", "Discover"], answer: "Discover" }],
		[{ prompt: "Which gas do plants take in from the air?", options: ["Oxygen", "Carbon dioxide", "Helium"], answer: "Carbon dioxide" }, { prompt: "How many sides does a hexagon have?", options: ["5", "6", "8"], answer: "6" }, { prompt: "Which is the largest ocean?", options: ["Atlantic", "Indian", "Pacific"], answer: "Pacific" }]
	],
	"13-19": [
		[{ prompt: "Solve: 3x = 21. What is x?", options: ["6", "7", "8"], answer: "7" }, { prompt: "What is 15% of 200?", options: ["20", "30", "35"], answer: "30" }, { prompt: "What is the square root of 144?", options: ["12", "14", "16"], answer: "12" }],
		[{ prompt: "Which word means 'to make less severe'?", options: ["Intensify", "Alleviate", "Ignore"], answer: "Alleviate" }, { prompt: "Which sentence uses 'their' correctly?", options: ["Their going home.", "The students packed their books.", "Put it over their."], answer: "The students packed their books." }, { prompt: "What is a synonym for 'accurate'?", options: ["Precise", "Vague", "Casual"], answer: "Precise" }],
		[{ prompt: "Which part of a cell contains most of its genetic material?", options: ["Nucleus", "Membrane", "Cytoplasm"], answer: "Nucleus" }, { prompt: "What is the chemical symbol for sodium?", options: ["S", "Na", "So"], answer: "Na" }, { prompt: "What is the sum of the angles in a triangle?", options: ["90°", "180°", "360°"], answer: "180°" }]
	]
};

const bibleQuestions = {
	"3-5": [
		{ question: "Who built a big ark?", options: ["Noah", "David", "Moses"], answer: "Noah" },
		{ question: "What was the name of Jesus' mother?", options: ["Mary", "Ruth", "Esther"], answer: "Mary" },
		{ question: "Who was swallowed by a big fish?", options: ["Jonah", "Peter", "Paul"], answer: "Jonah" }
	],
	"6-8": [
		{ question: "Who defeated Goliath?", options: ["David", "Solomon", "Joseph"], answer: "David" },
		{ question: "Where was Jesus born?", options: ["Bethlehem", "Jerusalem", "Nazareth"], answer: "Bethlehem" },
		{ question: "Who led the Israelites out of Egypt?", options: ["Moses", "Noah", "Samuel"], answer: "Moses" }
	],
	"9-12": [
		{ question: "What is the first book of the Bible?", options: ["Exodus", "Genesis", "Psalms"], answer: "Genesis" },
		{ question: "How many disciples did Jesus choose?", options: ["10", "12", "14"], answer: "12" },
		{ question: "Who climbed a tree to see Jesus?", options: ["Zacchaeus", "Thomas", "Andrew"], answer: "Zacchaeus" }
	],
	"13-19": [
		{ question: "Which book tells the story of Ruth?", options: ["Ruth", "Judges", "Ezra"], answer: "Ruth" },
		{ question: "Which apostle wrote many letters in the New Testament?", options: ["Paul", "Joshua", "Elijah"], answer: "Paul" },
		{ question: "In the parable, who helped the injured traveler?", options: ["A Samaritan", "A soldier", "A merchant"], answer: "A Samaritan" }
	]
};

function getAgeData(source) {
	return source[learner?.ageRange] || source[deriveAgeRange(learner?.age || 6)];
}

function renderGameLevels() {
	const progress = getLearnerProgress();
	const levels = $("#game-levels");
	levels.replaceChildren();
	["Number Skills", "Language Practice", "Applied Reasoning"].forEach((title, index) => {
		const level = index + 1;
		const button = document.createElement("button");
		button.type = "button";
		button.className = "level-card";
		button.disabled = level > progress.unlockedLevel;
		button.setAttribute("aria-label", `Level ${level}: ${title}${button.disabled ? ", locked" : ""}`);
		button.innerHTML = `<span>Level ${level}</span><strong>${title}</strong><small>${button.disabled ? "Locked" : "Available"}</small>`;
		if (!button.disabled) button.addEventListener("click", () => startGameLevel(level));
		levels.append(button);
	});
	$("#star-count").textContent = String(progress.stars);
}

function startGameLevel(level) {
	const gameData = getAgeData(gameSets);
	activeGame = { level, rounds: gameData[level - 1], index: 0, correct: 0 };
	$("#game-play-area").hidden = false;
	renderGameQuestion();
	beginActivityTimer();
}

function renderGameQuestion() {
	if (!activeGame) return;
	const question = activeGame.rounds[activeGame.index];
	$("#game-question").textContent = `Round ${activeGame.index + 1} of ${activeGame.rounds.length}: ${question.prompt}`;
	$("#game-feedback").textContent = "";
	const options = $("#game-options");
	options.replaceChildren();
	question.options.forEach((answer) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "answer-button";
		button.textContent = answer;
		button.addEventListener("click", () => {
			if (answer === question.answer) {
				activeGame.correct += 1;
				$("#game-feedback").textContent = "Correct.";
				$$("button", options).forEach((option) => { option.disabled = true; });
				window.setTimeout(advanceGame, 650);
			} else {
				$("#game-feedback").textContent = "Not quite. Give it another try!";
				button.disabled = true;
			}
		});
		options.append(button);
	});
}

function advanceGame() {
	if (!activeGame) return;
	activeGame.index += 1;
	if (activeGame.index < activeGame.rounds.length) {
		renderGameQuestion();
		return;
	}
	const progress = getLearnerProgress();
	progress.stars += activeGame.correct;
	progress.unlockedLevel = Math.max(progress.unlockedLevel, Math.min(3, activeGame.level + 1));
	saveProgress(progress);
	$("#game-question").textContent = "Level complete!";
	$("#game-feedback").textContent = `You earned ${activeGame.correct} point${activeGame.correct === 1 ? "" : "s"}. Good work.`;
	$("#game-options").replaceChildren();
	const backButton = document.createElement("button");
	backButton.type = "button";
	backButton.className = "button button--primary";
	backButton.textContent = "Choose another level";
	backButton.addEventListener("click", () => {
		activeGame = null;
		$("#game-play-area").hidden = true;
		renderGameLevels();
	});
	$("#game-options").append(backButton);
	renderGameLevels();
}

function startQuiz() {
	activeQuiz = { questions: getAgeData(bibleQuestions), index: 0, score: 0, answered: false };
	$("#quiz-result").hidden = true;
	$("#quiz-next-button").hidden = true;
	$("#quiz-options").hidden = false;
	renderQuizQuestion();
	beginActivityTimer();
}

function renderQuizQuestion() {
	const question = activeQuiz.questions[activeQuiz.index];
	$("#quiz-progress").textContent = `Question ${activeQuiz.index + 1} of ${activeQuiz.questions.length}`;
	$("#quiz-question").textContent = question.question;
	$("#quiz-feedback").textContent = "";
	$("#quiz-next-button").hidden = true;
	activeQuiz.answered = false;
	const options = $("#quiz-options");
	options.replaceChildren();
	question.options.forEach((answer) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "answer-button";
		button.textContent = answer;
		button.addEventListener("click", () => {
			if (activeQuiz.answered) return;
			activeQuiz.answered = true;
			const correct = answer === question.answer;
			if (correct) activeQuiz.score += 1;
			$$("button", options).forEach((option) => { option.disabled = true; });
			$("#quiz-feedback").textContent = correct ? "Correct. Well done." : `Good effort. The answer is ${question.answer}.`;
			$("#quiz-next-button").textContent = activeQuiz.index === activeQuiz.questions.length - 1 ? "See my score" : "Next question";
			$("#quiz-next-button").hidden = false;
		});
		options.append(button);
	});
}

function finishQuiz() {
	const progress = getLearnerProgress();
	progress.quizBest = Math.max(progress.quizBest, activeQuiz.score);
	saveProgress(progress);
	$("#quiz-options").hidden = true;
	$("#quiz-next-button").hidden = true;
	$("#quiz-question").textContent = "You finished the quiz!";
	$("#quiz-progress").textContent = "All done";
	$("#quiz-feedback").textContent = "";
	$("#quiz-result").hidden = false;
	$("#quiz-score").textContent = `You got ${activeQuiz.score} out of ${activeQuiz.questions.length} correct. Your best score is ${progress.quizBest}.`;
}

function nextQuizQuestion() {
	activeQuiz.index += 1;
	if (activeQuiz.index >= activeQuiz.questions.length) {
		finishQuiz();
		return;
	}
	renderQuizQuestion();
}

const puzzleIllustration = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 270"><rect width="360" height="270" fill="#e8ece6"/><rect x="30" y="24" width="300" height="154" rx="5" fill="#f5f3eb" stroke="#c9d2ca" stroke-width="3"/><circle cx="270" cy="68" r="20" fill="#c99a45"/><path d="M31 143 105 74l56 57 42-39 97 82H31Z" fill="#a7b9ad"/><path d="m121 147 79-75 98 99H121Z" fill="#779486"/><rect y="183" width="360" height="87" fill="#91816a"/><path d="M69 174q55-21 111 8 56-29 111-8v63q-57-18-111 10-56-28-111-10Z" fill="#fbfaf4" stroke="#61746e" stroke-width="3"/><path d="M180 182v65" stroke="#61746e" stroke-width="3"/><path d="M88 188q39-10 73 4m-73 7q39-10 73 4m42-11q35-14 72-4m-72 15q35-14 72-4" fill="none" stroke="#b6c0b8" stroke-width="2" stroke-linecap="round"/><path d="M47 183h266" stroke="#756750" stroke-width="3"/></svg>`;
const puzzleImageUrl = `url("data:image/svg+xml,${encodeURIComponent(puzzleIllustration)}")`;

function puzzleDimensions(ageRange) {
	if (ageRange === "3-5") return { columns: 2, rows: 2 };
	if (ageRange === "6-8") return { columns: 3, rows: 2 };
	if (ageRange === "9-12") return { columns: 3, rows: 3 };
	return { columns: 4, rows: 3 };
}

function startPuzzle() {
	const { columns, rows } = puzzleDimensions(learner?.ageRange);
	const count = columns * rows;
	const board = $("#puzzle-board");
	board.replaceChildren();
	board.style.setProperty("--puzzle-columns", String(columns));
	board.style.setProperty("--puzzle-rows", String(rows));

	const targets = document.createElement("div");
	targets.className = "puzzle-targets";
	targets.setAttribute("aria-label", "Empty picture spaces");
	const tray = document.createElement("div");
	tray.className = "puzzle-piece-tray";
	tray.setAttribute("aria-label", "Puzzle pieces");
	const order = Array.from({ length: count }, (_, index) => index);
	for (let index = order.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(Math.random() * (index + 1));
		[order[index], order[swapIndex]] = [order[swapIndex], order[index]];
	}
	puzzleState = { columns, rows, placed: new Set(), selectedPiece: null, count };

	for (let index = 0; index < count; index += 1) {
		const target = document.createElement("button");
		target.type = "button";
		target.className = "puzzle-target";
		target.dataset.target = String(index);
		target.setAttribute("aria-label", `Picture space ${index + 1}`);
		target.addEventListener("dragover", (event) => event.preventDefault());
		target.addEventListener("drop", (event) => {
			event.preventDefault();
			placePuzzlePiece(Number(event.dataTransfer.getData("text/plain")), index);
		});
		target.addEventListener("click", () => {
			if (puzzleState.selectedPiece !== null) placePuzzlePiece(puzzleState.selectedPiece, index);
		});
		targets.append(target);
	}

	order.forEach((pieceIndex) => {
		const piece = document.createElement("button");
		piece.type = "button";
		piece.className = "puzzle-piece";
		piece.draggable = true;
		piece.dataset.piece = String(pieceIndex);
		piece.setAttribute("aria-label", `Puzzle piece ${pieceIndex + 1}. Select this, then select a picture space.`);
		piece.style.backgroundImage = puzzleImageUrl;
		piece.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
		const column = pieceIndex % columns;
		const row = Math.floor(pieceIndex / columns);
		piece.style.backgroundPosition = `${columns === 1 ? 0 : (column / (columns - 1)) * 100}% ${rows === 1 ? 0 : (row / (rows - 1)) * 100}%`;
		piece.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", String(pieceIndex)));
		piece.addEventListener("click", () => {
			puzzleState.selectedPiece = pieceIndex;
			$$(".puzzle-piece", tray).forEach((item) => item.classList.toggle("is-selected", item === piece));
			$("#puzzle-feedback").textContent = "Now choose the matching picture space.";
		});
		tray.append(piece);
	});

	board.append(targets, tray);
	$("#puzzle-feedback").textContent = `Put ${count} pieces in the right places.`;
	beginActivityTimer();
}

function placePuzzlePiece(pieceIndex, targetIndex) {
	if (!puzzleState || puzzleState.placed.has(targetIndex)) return;
	if (pieceIndex !== targetIndex) {
			$("#puzzle-feedback").textContent = "This piece belongs elsewhere. Try a different space.";
		return;
	}
	const piece = $(`.puzzle-piece[data-piece="${pieceIndex}"]`);
	const target = $(`.puzzle-target[data-target="${targetIndex}"]`);
	if (!piece || !target) return;
	target.style.backgroundImage = piece.style.backgroundImage;
	target.style.backgroundSize = piece.style.backgroundSize;
	target.style.backgroundPosition = piece.style.backgroundPosition;
	target.classList.add("is-filled");
	target.disabled = true;
	piece.remove();
	puzzleState.placed.add(targetIndex);
	puzzleState.selectedPiece = null;

	if (puzzleState.placed.size === puzzleState.count) {
		const progress = getLearnerProgress();
		progress.puzzlesSolved += 1;
		progress.stars += 1;
		saveProgress(progress);
		$("#puzzle-feedback").textContent = "Picture complete. You earned one point.";
		const button = document.createElement("button");
		button.type = "button";
		button.className = "button button--primary";
		button.textContent = "Play another puzzle";
		button.addEventListener("click", startPuzzle);
		$("#puzzle-feedback").append(" ", button);
	} else {
		$("#puzzle-feedback").textContent = `${puzzleState.placed.size} of ${puzzleState.count} pieces in place.`;
	}
}

function beginSelectedActivity(pageId) {
	setCover(pageId);
	if (pageId === "games-page") {
		$("#game-play-area").hidden = true;
		renderGameLevels();
	} else if (pageId === "quiz-page") {
		startQuiz();
	} else if (pageId === "puzzle-page") {
		startPuzzle();
	}
}

function bindEvents() {
	$("#back-to-splash").addEventListener("click", () => setCover("splash-page"));
	$("#signup-tab").addEventListener("click", () => setAuthMode("signup"));
	$("#signin-tab").addEventListener("click", () => setAuthMode("signin"));
	$("#signup-form").addEventListener("submit", handleSignup);
	$("#signin-form").addEventListener("submit", handleSignin);
	$("#signin-email").addEventListener("change", (event) => {
		const account = readAccounts()[normalizeEmail(event.currentTarget.value)];
		$("#signin-whatsapp-consent").checked = account?.profile?.whatsappAlertsConsent === true;
	});

	$("#google-profile-form").addEventListener("submit", (event) => {
		event.preventDefault();
		if (!pendingGoogleProfile) {
			showToast("Please choose Continue with Google first.");
			setCover("account-page");
			return;
		}
		const data = new FormData(event.currentTarget);
		const profile = {
			...pendingGoogleProfile,
			gender: String(data.get("gender") || ""),
			age: Number(data.get("age")),
			guardianPhone: String(data.get("guardianPhone") || "").trim(),
			whatsappAlertsConsent: data.get("whatsappAlerts") === "on"
		};
		if (!profile.guardianPhone || !["Male", "Female"].includes(profile.gender) || profile.age < 3 || profile.age > 19) {
			showToast("Please check the profile details and enter an age from 3 to 19.");
			return;
		}
		profile.ageRange = deriveAgeRange(profile.age);
		const accounts = readAccounts();
		accounts[profile.email] = { profile, googleSignIn: true };
		try {
			writeAccounts(accounts);
		} catch {
			showToast("This browser couldn't save your profile. Check its storage settings.");
			return;
		}
		pendingGoogleProfile = null;
		const chatWindow = profile.whatsappAlertsConsent ? window.open("about:blank", "_blank") : null;
		if (chatWindow) {
			chatWindow.opener = null;
			chatWindow.location.replace(whatsappAlertUrl(profile));
		} else if (profile.whatsappAlertsConsent) {
			showWhatsAppDraftLink(profile);
		}
		showAgeCoverForProfile(profile);
	});

	$$("[data-age-range]").forEach((card) => {
		card.addEventListener("click", () => {
			if (!learner) return;
			learner.ageRange = card.dataset.ageRange;
			const accounts = readAccounts();
			const account = accounts[learner.email];
			if (account?.profile) {
				account.profile.ageRange = learner.ageRange;
				accounts[learner.email] = account;
				try { writeAccounts(accounts); } catch { showToast("Your level could not be saved on this device."); }
			}
			updateLearner(learner);
			setCover("welcome-page");
		});
	});

	$("#lets-play-button").addEventListener("click", () => setCover("activities-page"));
	$$("[data-open-page]").forEach((button) => {
		button.addEventListener("click", () => beginSelectedActivity(button.dataset.openPage));
	});
	$$("[data-back-to-activities]").forEach((button) => {
		button.addEventListener("click", () => {
			activeGame = null;
			activeQuiz = null;
			puzzleState = null;
			setCover("activities-page");
		});
	});

	$("#quiz-next-button").addEventListener("click", nextQuizQuestion);
	$("#quiz-again-button").addEventListener("click", startQuiz);
	$("#sign-out-button").addEventListener("click", () => {
		learner = null;
		activeGame = null;
		activeQuiz = null;
		puzzleState = null;
		$("#learner-avatar").hidden = true;
		setAuthMode("signin");
		setCover("splash-page");
		startIntroTimer();
	});

	$("#continue-activity-button").addEventListener("click", () => $("#encouragement-dialog").close());
	$("#encouragement-dialog").addEventListener("close", resumeActivityTimer);
	document.addEventListener("visibilitychange", () => {
		if (!timerActivity || timerPausedForDialog) return;
		if (document.hidden) {
			clearInterval(activityTimerId);
			activityTimerId = null;
		} else {
			scheduleActivityTick();
		}
	});

}

function init() {
	bindEvents();
	setAuthMode("signup");
	$("#learner-avatar").hidden = true;
	setupGoogleSignIn();
	startIntroTimer();
	if (GOOGLE_CLIENT_ID !== "YOUR_GOOGLE_CLIENT_ID" && !window.google?.accounts?.id) {
		let attempts = 0;
		const checkGoogle = window.setInterval(() => {
			attempts += 1;
			if (setupGoogleSignIn() || attempts >= 40) window.clearInterval(checkGoogle);
		}, 250);
	}
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
	init();
}
