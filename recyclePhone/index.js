const { CosmosClient } = require("@azure/cosmos");
const { EmailClient } = require("@azure/communication-email");
const axios = require("axios");

module.exports = async function (context, req) {
  context.log("Phone2Planet API triggered");

  try {
    const { name, email, phoneModel } = req.body || {};

    context.log("User request received:", { name, email, phoneModel });

    if (!name || !email || !phoneModel) {
      context.res = {
        status: 400,
        body: { error: "Missing required fields." },
      };
      return;
    }

    // ----------------------------
    // 1️⃣ COSMOS DB LOOKUP
    // ----------------------------

    context.log("Connecting to Cosmos DB...");

    const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION);
    const database = cosmosClient.database("phone2planet");
    const container = database.container("materials");

    const query = {
      query: "SELECT * FROM c WHERE c.phoneModel = @phoneModel",
      parameters: [{ name: "@phoneModel", value: phoneModel }],
    };

    const { resources } = await container.items.query(query).fetchAll();

    if (!resources.length) {
      context.log("Phone model not found in database");

      context.res = {
        status: 404,
        body: { error: "Phone model not found." },
      };
      return;
    }

    const materialData = resources[0];

    context.log("Material data retrieved:", materialData);

    // ----------------------------
    // 2️⃣ AI IMPACT REPORT
    // ----------------------------

    let aiSummary =
      "Your recycling action helps recover valuable materials and reduce e-waste.";

    context.log("Generating AI sustainability report...");

    try {
      const aiUrl = `${process.env.AI_ENDPOINT}openai/deployments/${process.env.AI_DEPLOYMENT}/chat/completions?api-version=2024-08-01-preview`;
      const response = await axios.post(
        aiUrl,
        {
          messages: [
            {
              role: "system",
              content:
                "You are an environmental sustainability assistant that explains recycling impact.",
            },
            {
              role: "user",
              content: `Generate a short recycling impact report for a ${phoneModel}.

Recovered materials:
Plastic: ${materialData.plastic}%
Zinc: ${materialData.zinc}%
Metal: ${materialData.metal}%

Explain the environmental benefits in 3 bullet points.`,
            },
          ],
          temperature: 0.6,
          max_tokens: 150,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "api-key": process.env.AI_API_KEY,
          },
        },
      );

      aiSummary = response.data.choices[0].message.content;

      context.log("AI report generated successfully");
    } catch (aiError) {
      context.log.error(
        "AI generation error:",
        aiError.response?.data || aiError.message,
      );
    }

    // ----------------------------
    // 3️⃣ SEND EMAIL
    // ----------------------------

    context.log("Preparing to send email to:", email);

    const emailClient = new EmailClient(process.env.ACS_CONNECTION_STRING);

    const poller = await emailClient.beginSend({
      senderAddress: process.env.ACS_SENDER_ADDRESS,
      recipients: {
        to: [{ address: email }],
      },
      content: {
        subject: "Your Phone2Planet Recycling Impact Report",
        html: `
          <h2>Hello ${name} 🌍</h2>
          <p>Thank you for recycling your <b>${phoneModel}</b> with Phone2Planet.</p>

          <h3>Recovered Materials</h3>
          <ul>
            <li>Plastic: ${materialData.plastic}%</li>
            <li>Zinc: ${materialData.zinc}%</li>
            <li>Metal: ${materialData.metal}%</li>
          </ul>

          <h3>AI Sustainability Insight</h3>
          <p>${aiSummary}</p>

          <p>Together we make the planet greener.</p>
        `,
      },
    });

    await poller.pollUntilDone();

    context.log("Email sent successfully");

    // ----------------------------
    // 4️⃣ SUCCESS RESPONSE
    // ----------------------------

    context.res = {
      status: 200,
      body: {
        message: `Thank you ${name}! Recycling your ${phoneModel} helps recover valuable materials.`,
        materials: {
          plastic: materialData.plastic,
          zinc: materialData.zinc,
          metal: materialData.metal,
        },
        ai_summary: aiSummary,
      },
    };
  } catch (error) {
    context.log.error("Server Error:", error.message, error.stack);

    context.res = {
      status: 500,
      body: {
        error: "Server error processing request",
        detail: error.message,
      },
    };
  }
};
