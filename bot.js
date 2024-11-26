const { chromium } = require('playwright');
const fs = require('fs');
const { parse } = require('json2csv');

let results = [];
const keywords = [
    "Places to eat",
    "Italian restaurants",
    "Mexican restaurants",
    "Chinese restaurants",
    "Japanese sushi bars",
    "Indian restaurants",
    "Mediterranean restaurants",
    "Vegan restaurants",
    "Vegetarian-friendly places",
    "Gluten-free restaurants",
    "Seafood restaurants",
    "Steakhouses",
    "Burger joints",
    "Pizza places",
    "Wood-fired pizza spots",
    "Thai restaurants",
    "BBQ spots",
    "Korean BBQ",
    "Fine dining",
    "Casual dining",
    "Farm-to-table restaurants",
    "Brunch spots",
    "Breakfast cafes",
    "Fast food",
    "Drive-thru spots",
    "Healthy restaurants",
    "Low-carb options",
    "Dessert cafes",
    "Ice cream parlors",
    "Bakery cafes",
    "Coffee shops",
    "Boba tea shops",
    "Specialty coffee",
    "Espresso bars",
    "Latte art cafes",
    "Cold brew spots",
    "Bubble tea cafes",
    "Matcha tea bars",
    "Milk tea places",
    "Craft coffee roasters",
    "Nitro coffee spots",
    "Tea lounges",
    "Herbal tea spots",
    "High tea venues",
    "Coffee and dessert spots",
    "Juice bars",
    "Smoothie cafes",
    "Acai bowl spots",
    "Poke bowl restaurants",
    "Taco stands",
    "Food trucks",
    "Pop-up restaurants",
    "Fusion cuisine spots",
    "Outdoor dining options",
    "Romantic restaurants",
    "Rooftop dining",
    "Family-friendly restaurants",
    "Kid-friendly cafes"
]; // Add more keywords if needed
const locations = ["Cypress, TX"]; // Add more locations if needed

async function run() {
    const browser = await chromium.launch({ headless: false, slowMo: 50 });
    const context = await browser.newContext();
    const page = await context.newPage();

    for (let keyword of keywords) {
        for (let location of locations) {
            await page.goto(`https://www.google.com/maps/search/${keyword} ${location}`, { waitUntil: 'domcontentloaded' });

            // Press the down arrow key until a span with "You've reached the end of the list." is found
            const scrollWithArrowKey = async () => {
                await page.click('h1:text("Results")');
                // if scrollWithArrowKey runs for more than 2 minutes, stop it, scrape the data and continue

                const startTime = Date.now();
                while (true) {
                    await page.keyboard.press('ArrowDown');
                    const isEndOfList = await page.$('span:text("You\'ve reached the end of the list.")');
                    if (isEndOfList) break;
                    if (Date.now() - startTime > 150000) break; // 2 minutes
                }
            };

            try {
                await scrollWithArrowKey();
            }
            catch (err) {
                continue;
            }
        
            // Scrape the data
            const data = await scrapeData(page, location);
            results = results.concat(data);

            // wait for user input
            await page.waitForTimeout(5000);
        }
    }

    // Iterate over results and scrape for phone numbers, removing items with websites
    for (let i = results.length - 1; i >= 0; i--) {
        const result = results[i];
        if (result.href) {
            await page.goto(result.href, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(500); // Slight delay for dynamic content to load

            // Check for an external website that is not a Google Maps link
            const externalWebsite = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a[href^="http"]'));
                return links.find(link => {
                    const url = link.href.toLowerCase();
                    // Exclude Google Maps or Google-related links
                    return !url.includes('google.com') && !url.includes('googleusercontent.com');
                })?.href || null;
            });

            if (externalWebsite) {
                console.log(`Website found for: ${result.title} (${externalWebsite}). Removing from results.`);
                results.splice(i, 1); // Remove the item from the list
                continue;
            }

            // This place may be closed
            // Temporarily closed
            // Permanently closed

            // Check for span with texts, "This place may be closed", "Temporarily closed", "Permanently closed"
            const isClosed = await page.evaluate(() => {
                const closedTexts = ["This place may be closed", "Temporarily closed", "Permanently closed"];
                return closedTexts.some(text => document.body.textContent.includes(text));
            });

            if (isClosed) {
                // Remove the item from the list
                results.splice(i, 1);
                continue;
            }

            // Scrape the phone number
            const phone = await page.evaluate(() => {
                const phoneRegex = /(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
                const phoneMatch = document.body.textContent.match(phoneRegex);
                return phoneMatch ? phoneMatch[0] : '';
            });

            // Update the phone number in the results array
            if(phone === '') {
                // Remove the item from the list if there is no phone number
                results.splice(i, 1);
                continue;
            }
            result.phone = phone;
        }
    }

    await browser.close();

    convertResultsToCSV(results);
}

run();

async function scrapeData(page, city) {
    city = city.split(',')[0]; // Remove state abbreviation
    return await page.evaluate((city) => {
        const links = Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place"]'));
        return links.map(link => {
            const container = link.closest('[jsaction*="mouseover:pane"]');
            const titleText = container ? container.querySelector('.fontHeadlineSmall').textContent : '';
            let rating = '';
            let reviewCount = '';
            let phone = '';
            let companyUrl = '';

            // Rating and Reviews
            if (container) {
                const roleImgContainer = container.querySelector('[role="img"]');
                if (roleImgContainer) {
                    const ariaLabel = roleImgContainer.getAttribute('aria-label');
                    if (ariaLabel && ariaLabel.includes("stars")) {
                        const parts = ariaLabel.split(' ');
                        rating = parts[0];
                        reviewCount = '(' + parts[2] + ')';
                        reviewCount = reviewCount.replace(/[()]/g, '');
                    } else {
                        rating = '0';
                        reviewCount = '0';
                    }
                }
            }

            // Company URL
            if (container) {
                const allLinks = Array.from(container.querySelectorAll('a[href]'));
                const filteredLinks = allLinks.filter(a => !a.href.startsWith("https://www.google.com/maps/place/"));
                if (filteredLinks.length > 0) {
                    companyUrl = filteredLinks[0].href;
                }
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
                href: link.href,
                location: city
            };
        }).filter(item => item !== null);
    }, city);
}

function convertResultsToCSV(results) {
    const fields = ['title', 'rating', 'reviewCount', 'phone', 'href', 'city'];
    const opts = { fields };

    try {
        const csv = parse(results, opts);
        fs.writeFileSync('results.csv', csv);
        console.log('CSV file successfully processed');
    } catch (err) {
        console.error(err);
    }
}
