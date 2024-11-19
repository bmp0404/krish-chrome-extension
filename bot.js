const { chromium } = require('playwright');
const fs = require('fs');
const { parse } = require('json2csv');

let results = [];
const keywords = ["Chinese Takeout"]; // Add more keywords if needed
const locations = ["Houston, TX"]; // Add more locations if needed

async function run() {
    const browser = await chromium.launch({ headless: false, slowMo: 50 });
    const context = await browser.newContext();
    const page = await context.newPage();

    for (let keyword of keywords) {
        for (let location of locations) {
            await page.goto(`https://www.google.com/maps/search/${keyword} ${location}`, { waitUntil: 'domcontentloaded' });

            // Press the down arrow key until a span with "You've reached the end of the list." is found
            const scrollWithArrowKey = async () => {
                // Click on h1 with text 'Results'  to focus on the search input
                await page.click('h1:text("Results")');
                while (true) {
                    await page.keyboard.press('ArrowDown'); // Press the down arrow key
                    // await page.waitForTimeout(300); // Small delay between key presses

                    // Check if "You've reached the end of the list." span is visible
                    const isEndOfList = await page.$('span:text("You\'ve reached the end of the list.")');
                    if (isEndOfList) break; // Stop scrolling if end of list is reached
                }
            };

            await scrollWithArrowKey();

            // Scrape the data
            const data = await scrapeData(page);
            results = results.concat(data);

            // wait for user input
            await page.waitForTimeout(5000);
        }
    }

    console.log(results);
    convertResultsToCSV(results);
    await browser.close();
}

run();
async function scrapeData(page) {
    return await page.evaluate(() => {
        var links = Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place"]'));
        return links.map(link => {
            var container = link.closest('[jsaction*="mouseover:pane"]');
            var titleText = container ? container.querySelector('.fontHeadlineSmall').textContent : '';
            var rating = '';
            var reviewCount = '';
            var phone = '';
            var industry = '';
            var address = '';
            var companyUrl = '';

            // Rating and Reviews
            if (container) {
                var roleImgContainer = container.querySelector('[role="img"]');
                
                if (roleImgContainer) {
                    var ariaLabel = roleImgContainer.getAttribute('aria-label');
                
                    if (ariaLabel && ariaLabel.includes("stars")) {
                        var parts = ariaLabel.split(' ');
                        rating = parts[0];
                        reviewCount = '(' + parts[2] + ')'; 
                    } else {
                        rating = '0';
                        reviewCount = '0';
                    }
                }
            }

            // Address and Industry
            if (container) {
                var containerText = container.textContent || '';
                var addressRegex = /\d+ [\w\s]+(?:#\s*\d+|Suite\s*\d+|Apt\s*\d+)?/;
                var addressMatch = containerText.match(addressRegex);

                if (addressMatch) {
                    address = addressMatch[0];

                    var textBeforeAddress = containerText.substring(0, containerText.indexOf(address)).trim();
                    var ratingIndex = textBeforeAddress.lastIndexOf(rating + reviewCount);
                    if (ratingIndex !== -1) {
                        var rawIndustryText = textBeforeAddress.substring(ratingIndex + (rating + reviewCount).length).trim().split(/[\r\n]+/)[0];
                        industry = rawIndustryText.replace(/[·.,#!?]/g, '').trim();
                    }
                    var filterRegex = /\b(Closed|Open 24 hours|24 hours)|Open\b/g;
                    address = address.replace(filterRegex, '').trim();
                    address = address.replace(/(\d+)(Open)/g, '$1').trim();
                    address = address.replace(/(\w)(Open)/g, '$1').trim();
                    address = address.replace(/(\w)(Closed)/g, '$1').trim();
                } else {
                    address = '';
                }
            }

            // Company URL
            if (container) {
                var allLinks = Array.from(container.querySelectorAll('a[href]'));
                var filteredLinks = allLinks.filter(a => !a.href.startsWith("https://www.google.com/maps/place/"));
                if (filteredLinks.length > 0) {
                    companyUrl = filteredLinks[0].href;
                }
            }

            // Phone Numbers
            if (container) {
                var containerText = container.textContent || '';
                var phoneRegex = /(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
                var phoneMatch = containerText.match(phoneRegex);
                phone = phoneMatch ? phoneMatch[0] : '';
            }

            // Skip establishments with a company URL
            if (companyUrl) {
                return null;
            }

            // Return the data as an object
            return {
                title: titleText,
                rating: rating,
                reviewCount: reviewCount,
                phone: phone,
                industry: industry,
                address: address,
                companyUrl: companyUrl,
                href: link.href,
            };
        }).filter(item => item !== null); // Remove null results
    });
}

function convertResultsToCSV(results) {
    const fields = ['title', 'rating', 'reviewCount', 'phone', 'industry', 'address', 'companyUrl', 'href'];
    const opts = { fields };

    try {
        const csv = parse(results, opts);
        fs.writeFileSync('results.csv', csv);
        console.log('CSV file successfully processed');
    } catch (err) {
        console.error(err);
    }
}