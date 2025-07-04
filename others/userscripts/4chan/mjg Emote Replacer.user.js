// ==UserScript==
// @name         /mjg/ Emote Replacer
// @namespace    http://repo.riichi.moe/
// @version      1.3.8
// @description  Detects emote strings in imageless posts in /mjg/ threads, and displays them as fake images posts.
// @icon         https://files.catbox.moe/3sh459.png
// @author       Ling and Anon
// @match        *://boards.4chan.org/vg/thread/*
// @grant        none
// @downloadURL  https://repo.riichi.moe/others/userscripts/4chan/mjg%20Emote%20Replacer.user.js
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const IMAGE_LIMIT = 0; // Change this to 375 if you want the script to only work after the thread has hit the image limit

    // Sources for MJS and RC emotes
    const EMOTE_BASE_URLS = [
        'https://files.riichi.moe/mjg/game%20resources%20and%20tools/Mahjong%20Soul/game%20files/emotes/',
        'https://tanoshii.moe/images/riichi_city_emotes/'
    ];

    const EMOTE_REGEX = /\b(([a-zA-Z0-9\-\.]+-\d+[cehjk]?t?d?|mooncakes\/\d)\.(?:png|jpg|jpeg|gif))\b/i;
    const PROCESSED_MARKER = 'data-mjg-emote-processed'; // Values: 'true' (success), 'has-file', 'no-message', 'limit-not-reached', 'emote-not-found', 'checking'

    // --- Helper: Check if remote image exists (tries multiple URLs) ---
    function checkImageExists(urls) {
        return new Promise(async resolve => {
            for (const url of urls) {
                try {
                    const img = new Image();
                    const result = await new Promise(resolve => {
                        img.onload = () => resolve(true);  // Image loaded successfully
                        img.onerror = () => resolve(false);  // Image failed to load (404, CORS block, invalid etc.)
                        img.onabort = () => resolve(false);  // Handle aborts as well
                        try {
                            img.src = url;
                        } catch (e) {
                            console.error("/mjg/ Emote Replacer: Error synchronously thrown while setting src for " + url, e);
                            resolve(false);
                        }
                    });
                    if (result) {
                        resolve({ exists: true, url: url });
                        return;
                    }
                } catch (e) {
                    // Continue to next URL
                }
            }
            resolve({ exists: false, url: null });
        });
    }

    // --- Helper: Find Emote String by Traversing Nodes (Recursive) ---
    function findEmoteInNodes(parentNode) {
        for (const node of parentNode.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.nodeValue.trim();
                if (text) {
                    const match = text.match(EMOTE_REGEX);
                    if (match && match[1]) {
                        return match[1];
                    }
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'SPAN' && node.classList.contains('quote')) {
                    const matchInQuote = findEmoteInNodes(node);
                    if (matchInQuote) {
                        return matchInQuote;
                    }
                }
                // else: Skip other elements implicitly
            }
        }
        return null;
    }

    // --- 1. Check if this is the correct type of thread ---
    function isMjgThread() {
        const opSubjectElement = document.querySelector('.opContainer .postInfo .subject, .opContainer .postInfoM .subject');
        if (!opSubjectElement) return false;
        const subjectText = opSubjectElement.textContent.toLowerCase();
        return subjectText.includes('mjg') || subjectText.includes('mahjong');
    }

    // --- 2. Get current image count ---
    function getImageCount() {
        let fileCountElement = document.getElementById('file-count');
        if (!fileCountElement) {
            const threadStatsDiv = document.querySelector('.thread-stats .ts-images');
            if (threadStatsDiv) fileCountElement = threadStatsDiv;
        }
        if (fileCountElement?.textContent) {
            const count = parseInt(fileCountElement.textContent.trim(), 10);
            return isNaN(count) ? -1 : count;
        }
        return -1;
    }

    // --- 3. Create and inject fake image HTML ---
    function addFakeImage(postElement, emoteString, resolvedUrl) {
        const postId = postElement.id ? postElement.id.substring(1) : null;
        if (!postId) {
            console.warn("/mjg/ Emote Replacer: Could not get post ID for", postElement);
            return; // Should not happen if called after check
        }
        // Double check file doesn't exist (in case of race condition)
        if (postElement.querySelector('.file')) return;

        const fullImageUrl = resolvedUrl;
        const uniqueFileId = `f${postId}-emote`;
        const uniqueFileTextId = `fT${postId}-emote`;

        const fileDiv = document.createElement('div');
        fileDiv.className = 'file';
        fileDiv.id = uniqueFileId;

        const fileTextDiv = document.createElement('div');
        fileTextDiv.className = 'fileText';
        fileTextDiv.id = uniqueFileTextId;
        fileTextDiv.innerHTML = `
            <span class="file-info">
                File: <a href="${fullImageUrl}" target="_blank">${emoteString}</a> (Emote)
            </span>
            <span class="fileText-original" style="display: none;">
                File: <a href="${fullImageUrl}" target="_blank">${emoteString}</a> (Emote)
            </span>`;

        const fileThumbLink = document.createElement('a');
        fileThumbLink.className = 'fileThumb';
        fileThumbLink.href = fullImageUrl;
        fileThumbLink.target = '_blank';

        const img = document.createElement('img');
        img.src = fullImageUrl;
        img.alt = `Emote: ${emoteString}`;
        img.style.width = '125px';
        img.style.height = 'auto';
        img.style.maxWidth = '200px';
        img.style.maxHeight = '200px';
        img.loading = 'lazy';

        const mobileInfoDiv = document.createElement('div');
        mobileInfoDiv.className = 'mFileInfo mobile';
        mobileInfoDiv.textContent = 'Emote';

        fileThumbLink.appendChild(img);
        fileThumbLink.appendChild(mobileInfoDiv);

        fileDiv.appendChild(fileTextDiv);
        fileDiv.appendChild(fileThumbLink);

        const postInfoDesktop = postElement.querySelector('.postInfo.desktop');
        const postInfoMobile = postElement.querySelector('.postInfoM.mobile');
        const insertionPoint = postInfoDesktop || postInfoMobile;
        const blockquote = postElement.querySelector('blockquote.postMessage');

        if (insertionPoint && insertionPoint.nextSibling) {
            postElement.insertBefore(fileDiv, insertionPoint.nextSibling);
        } else if (blockquote) {
            postElement.insertBefore(fileDiv, blockquote);
        } else if (insertionPoint) {
            insertionPoint.parentNode.appendChild(fileDiv);
        } else {
            postElement.appendChild(fileDiv);
        }
        // console.log(`/mjg/ Emote Replacer: Added fake image for ${emoteString} to post ${postId}`);
    }


    // --- 4. Process a single post ---
    async function processPost(postElement) {
        // Basic checks first
        const postId = postElement?.id || 'unknown-element';
        if (!postElement || !postElement.matches || !postElement.matches('.post.reply')) return;

        // Prevent re-processing or processing posts currently being checked
        const currentState = postElement.getAttribute(PROCESSED_MARKER);
        // Already processed, has file, no message, emote not found, or currently checking
        if (currentState && currentState !== 'limit-not-reached') return;

        // Check if it already has a *real* file attachment
        if (postElement.querySelector('.file')) { postElement.setAttribute(PROCESSED_MARKER, 'has-file'); return; }

        // Check if image limit is reached *now*
        const currentImageCount = getImageCount();
        if (currentImageCount === -1 || currentImageCount < IMAGE_LIMIT) {
            postElement.setAttribute(PROCESSED_MARKER, 'limit-not-reached'); // Mark temporarily
            return;
        }
        // If limit was previously not reached, clear that temporary state
        if (currentState === 'limit-not-reached') {
            postElement.removeAttribute(PROCESSED_MARKER);
        }

        const postMessageElement = postElement.querySelector('.postMessage');
        if (!postMessageElement) {
            postElement.setAttribute(PROCESSED_MARKER, 'no-message');
            return;
        }

        const emoteString = findEmoteInNodes(postMessageElement);

        if (emoteString) {
            // Generate all candidate URLs for this emote
            const candidateUrls = EMOTE_BASE_URLS.map(base => base + encodeURIComponent(emoteString));

            // Mark as checking to prevent concurrent checks from observer
            postElement.setAttribute(PROCESSED_MARKER, 'checking');

            // Small delay might prevent rare race conditions.
            await new Promise(resolve => setTimeout(resolve, 50));

            if (postElement.getAttribute(PROCESSED_MARKER) !== 'checking') return; // State changed during await

            // Check if the remote image actually exists
            const imageExists = await checkImageExists(candidateUrls);
            if (postElement.getAttribute(PROCESSED_MARKER) !== 'checking') return; // State changed during check
            if (imageExists.exists) {
                addFakeImage(postElement, emoteString, imageExists.url);
                postElement.setAttribute(PROCESSED_MARKER, 'true');
            } else {
                // Mark as processed but note that the emote was not found
                postElement.setAttribute(PROCESSED_MARKER, 'emote-not-found');
            }
        } else {
            // No emote string found in this post, mark it as processed for this state
            postElement.setAttribute(PROCESSED_MARKER, 'no-emote-found');
        }
    }

    // --- 5. Initial Scan ---
    function initialScan() {
        const posts = document.querySelectorAll('.postContainer.replyContainer .post.reply');
        posts.forEach(post => {
            processPost(post).catch(e => {
                console.error("/mjg/ Emote Replacer: Error during async processPost in initial scan:", post?.id, e);
                // Mark post to avoid retrying on error.
                if (post) post.setAttribute(PROCESSED_MARKER, 'error');
            });
        });
    }

    // --- 6. Observe for new posts ---
    function observeNewPosts() {
        const threadElement = document.querySelector('.thread');
        if (!threadElement) {
            console.error('/mjg/ Emote Replacer: Could not find thread element to observe.');
            return;
        }
        const observer = new MutationObserver(mutations => {
            let postsToProcess = new Set();
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches('.postContainer.replyContainer')) {
                            const postElement = node.querySelector('.post.reply');
                            if (postElement) postsToProcess.add(postElement);
                        } else {
                            node.querySelectorAll('.postContainer.replyContainer .post.reply').forEach(postElement => {
                                postsToProcess.add(postElement);
                            });
                        }
                    }
                });
            });

            if (postsToProcess.size > 0) {
                postsToProcess.forEach(postElement => {
                    processPost(postElement).catch(e => {
                        console.error("/mjg/ Emote Replacer: Error during async processPost from observer:", postElement?.id, e);
                        if (postElement) postElement.setAttribute(PROCESSED_MARKER, 'error');
                    });
                });
            }
        });

        observer.observe(threadElement, { childList: true, subtree: true });
    }

    // --- Main Execution ---
    if (isMjgThread()) {
        requestAnimationFrame(() => {
            initialScan();
            observeNewPosts();
        });
    }

})();
