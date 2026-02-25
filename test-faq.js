const fs = require('fs');

const questions = [
  "How can I get a quotation for a custom tour?",
  "Is it possible to book a Danang tour for a family of 5?",
  "What payment methods do you accept? Do you allow installment payments?",
  "What is your cancellation and refund policy?",
  "Do you provide visa application assistance or agent services?",
  "Are guide tips included in the tour price, or do I need to pay them separately in cash?",
  "Can I purchase flight tickets only without booking a full tour package?",
  "Can I customize or change the itinerary of a private tour?",
  "Do you provide baby car seats for families traveling with infants?",
  "How much does it cost to upgrade my hotel room to a suite?",
  "My passport expires in 3 months. Can I still travel to Korea?",
  "Can I get a tax invoice or cash receipt for my booking?",
  "What happens to outdoor tours if it rains heavily?",
  "How much free time is included in the daily itinerary?",
  "Are the tour courses wheelchair accessible?",
  "Will the price change if the number of participants increases after booking?",
  "My flight is late at night. Can I store my luggage somewhere after hotel checkout?",
  "Do I have to pay a single supplement charge if I travel alone?",
  "Are the provided meals authentic local food or just international buffets?",
  "Do you offer any pet-friendly travel packages?",
  "Can I request a vegetarian or vegan meal for the tour?",
  "Is travel insurance included in the package?",
  "How do I contact the tour guide in case of an emergency?",
  "What is the maximum luggage allowance per person?",
  "Can I join the tour group midway if I arrive late?",
  "Do your guides speak languages other than Korean and English?",
  "Are entrance fees for museums and attractions included?",
  "How early should I book the tour during the peak holiday season?",
  "Do you offer discounts for large group bookings or corporate events?",
  "Is there a minimum number of participants required for the tour to proceed?"
];

async function runTests() {
  console.log("Starting FAQ Chatbot Quality Test (30 English Questions)...");
  const results = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(`[${i+1}/30] Q: ${q}`);
    try {
      const start = Date.now();
      const res = await fetch('http://localhost:4000/api/faq/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q })
      });
      const data = await res.json();
      const duration = Date.now() - start;
      const answer = data.answer || data.content || JSON.stringify(data);
      console.log(`    Time: ${duration}ms\n    A: ${answer.substring(0, 80)}...\n`);
      
      results.push({
        id: i + 1,
        question: q,
        answer: data.answer || data.content,
        duration,
        sources: data.sources || null
      });
    } catch (err) {
      console.error(`    Error: ${err.message}`);
      results.push({
        id: i + 1,
        question: q,
        error: err.message
      });
    }
    // 짧은 딜레이 추가 (API Rate Limit 방지)
    await new Promise(r => setTimeout(r, 1200));
  }

  fs.writeFileSync('faq_test_results_eng.json', JSON.stringify(results, null, 2), 'utf-8');
  console.log("Test Complete. Results saved to faq_test_results_eng.json");
}

runTests();
