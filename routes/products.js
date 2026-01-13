// routes/products.js
import express from "express";
import { db } from "../configs/index.js";
import { productsTable, productVariantsTable, activityLogsTable, ordersTable, orderItemsTable, wishlistTable, } from "../configs/schema.js"; // 🟢 Added
import { eq, inArray, notInArray, desc, sql, and, gt, ne } from "drizzle-orm";
import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllProductsKey, makeProductKey } from "../cacheKeys.js";

const router = express.Router();

// ------------------------------------------------------------------
// 🧠 FRAGRANCE INTELLIGENCE ENGINE (Knowledge Base)
// ------------------------------------------------------------------
// This maps abstract human concepts to specific perfumery ingredients.
const SCENT_INTELLIGENCE = {
  // --- OCCASIONS ---
  occasions: {
    "night": { // Date Night, Intimate, Evening
      notes: ["vanilla", "amber", "musk", "oud", "rose", "patchouli", "sandalwood", "tobacco", "leather", "tonka", "cinnamon", "cardamom", "jasmine", "black orchid", "cocoa"],
      preferredFamilies: ["oriental", "gourmand", "woody", "spicy"]
    },
    "office": { // Boardroom, Professional, Work
      notes: ["bergamot", "vetiver", "cedar", "neroli", "lemon", "white musk", "iris", "green tea", "grapefruit", "ginger", "mint", "bamboo", "lavender"],
      preferredFamilies: ["citrus", "fresh", "green", "aromatic"]
    },
    "gala": { // Celebration, Luxury, Party
      notes: ["oud", "saffron", "tuberose", "champagne", "gold amber", "black currant", "ylang-ylang", "rose", "incense", "myrrh", "truffle"],
      preferredFamilies: ["floral", "oriental", "chypre"]
    },
    "day": { // Casual, Everyday, Brunch
      notes: ["sea salt", "aqua", "apple", "pear", "peach", "lavender", "sage", "white tea", "cotton", "peony", "freesia", "lily", "citrus"],
      preferredFamilies: ["aquatic", "fruity", "floral", "fresh"]
    }
  },

  // --- VIBES ---
  vibes: {
    "powerful": { // Commanding, Bold
      notes: ["oud", "leather", "tobacco", "black pepper", "cedarwood", "oakmoss", "patchouli", "dark musk", "civet", "birch"],
    },
    "mysterious": { // Complex, Dark, Enigma
      notes: ["incense", "myrrh", "violet", "labdanum", "guaiac wood", "dark chocolate", "plum", "black orchid", "smoke", "resins"],
    },
    "playful": { // Radiant, Energetic, Sweet
      notes: ["citrus", "raspberry", "strawberry", "honey", "caramel", "coconut", "mint", "pink pepper", "orange blossom", "vanilla"],
    },
    "serene": { // Grounded, Calm, Nature
      notes: ["bamboo", "green tea", "eucalyptus", "sandalwood", "chamomile", "white woods", "lotus", "fig", "matcha", "cashmere"],
    }
  }
};

// ... [GET Routes Unchanged] ...
router.get("/", cache(makeAllProductsKey(), 3600), async (req, res) => {
  try {
    const products = await db.query.productsTable.findMany({
      where: eq(productsTable.isArchived, false),
      with: { variants: { where: eq(productVariantsTable.isArchived, false) } },
    });
    res.json(products);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/archived", async (req, res) => {
  try {
    const archivedProducts = await db.query.productsTable.findMany({
      where: eq(productsTable.isArchived, true),
      with: { variants: true },
    });
    res.json(archivedProducts);
  } catch (error) {
    console.error("❌ Error fetching archived products:", error);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id", cache((req) => makeProductKey(req.params.id), 1800), async (req, res) => {
  try {
    const { id } = req.params;
    const product = await db.query.productsTable.findFirst({
      where: and(eq(productsTable.id, id), eq(productsTable.isArchived, false)),
      with: { variants: { where: eq(productVariantsTable.isArchived, false) }, reviews: true },
    });

    if (!product) return res.status(404).json({ error: "Product not found" });
    if (typeof product.imageurl === "string") { try { product.imageurl = JSON.parse(product.imageurl); } catch { } }
    res.json(product);
  } catch (error) {
    console.error("❌ Error fetching product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 POST add new product (Modified for Logging)
 */
router.post("/", async (req, res) => {
  const { variants, actorId, ...productData } = req.body; // 🟢 Extract actorId

  if (!Array.isArray(variants) || variants.length === 0) {
    return res.status(400).json({ error: "Product must have at least one variant." });
  }

  try {
    const newProduct = await db.transaction(async (tx) => {
      const [product] = await tx.insert(productsTable).values({
        name: productData.name,
        description: productData.description,
        composition: productData.composition,
        fragrance: productData.fragrance,
        fragranceNotes: productData.fragranceNotes,
        category: productData.category,
        imageurl: productData.imageurl,
      }).returning();

      const variantsToInsert = variants.map((variant) => ({
        ...variant,
        productId: product.id,
      }));

      const insertedVariants = await tx.insert(productVariantsTable).values(variantsToInsert).returning();

      // 🟢 LOG ACTIVITY
      if (actorId) {
        await tx.insert(activityLogsTable).values({
          userId: actorId, // Admin ID (Actor)
          action: 'PRODUCT_CREATE',
          description: `Created product: ${product.name}`,
          performedBy: 'admin',
          metadata: { productId: product.id }
        });
      }

      return { ...product, variants: insertedVariants };
    });

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(newProduct.id), prefix: true },
    ]);

    res.status(201).json(newProduct);
  } catch (error) {
    console.error("❌ Error adding product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 PUT update product (Modified for Logging)
 */
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    variants, oprice, discount, size, stock,
    costPrice, sold, sku, isArchived, actorId, // 🟢 Extract actorId
    ...productData
  } = req.body;

  try {
    const currentProduct = await db.query.productsTable.findFirst({ where: eq(productsTable.id, id) });

    const [updatedProduct] = await db
      .update(productsTable)
      .set(productData)
      .where(eq(productsTable.id, id))
      .returning();

    if (!updatedProduct) return res.status(404).json({ error: "Product not found." });

    // 🟢 LOG CHANGES
    if (actorId && currentProduct) {
      const changes = [];
      if (productData.name && productData.name !== currentProduct.name) changes.push("Name");
      if (productData.category && productData.category !== currentProduct.category) changes.push("Category");
      // Add more field checks if needed

      if (changes.length > 0 || variants) {
        await db.insert(activityLogsTable).values({
          userId: actorId,
          action: 'PRODUCT_UPDATE',
          description: `Updated product ${updatedProduct.name}: ${changes.length > 0 ? changes.join(', ') : 'Variants updated'}`,
          performedBy: 'admin',
          metadata: { productId: id, changes }
        });
      }
    }

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(id), prefix: true },
    ]);

    res.json(updatedProduct);
  } catch (error) {
    console.error("❌ Error updating product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 PUT archive product (Modified for Logging)
 */
router.put("/:id/archive", async (req, res) => {
  const { id } = req.params;
  const { actorId } = req.body; // 🟢 Extract actorId

  try {
    const [archivedProduct] = await db
      .update(productsTable)
      .set({ isArchived: true })
      .where(eq(productsTable.id, id))
      .returning();

    if (!archivedProduct) return res.status(404).json({ error: "Product not found." });

    // 🟢 LOG ACTIVITY
    if (actorId) {
      await db.insert(activityLogsTable).values({
        userId: actorId,
        action: 'PRODUCT_ARCHIVE',
        description: `Archived product: ${archivedProduct.name}`,
        performedBy: 'admin',
        metadata: { productId: id }
      });
    }

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(id), prefix: true },
    ]);

    res.json({ success: true, archivedProduct });
  } catch (error) {
    console.error("❌ Error archiving product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 PUT unarchive product (Modified for Logging)
 */
router.put("/:id/unarchive", async (req, res) => {
  const { id } = req.params;
  const { actorId } = req.body; // 🟢 Extract actorId

  try {
    const [unarchivedProduct] = await db
      .update(productsTable)
      .set({ isArchived: false })
      .where(eq(productsTable.id, id))
      .returning();

    if (!unarchivedProduct) return res.status(404).json({ error: "Product not found." });

    // 🟢 LOG ACTIVITY
    if (actorId) {
      await db.insert(activityLogsTable).values({
        userId: actorId,
        action: 'PRODUCT_UNARCHIVE',
        description: `Unarchived product: ${unarchivedProduct.name}`,
        performedBy: 'admin',
        metadata: { productId: id }
      });
    }

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(id), prefix: true },
    ]);

    res.json({ success: true, unarchivedProduct });
  } catch (error) {
    console.error("❌ Error unarchiving product:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// 🟢 NEW: Manual Cache Invalidation Endpoint
router.post("/cache/invalidate", async (req, res) => {
  try {
    // Invalidate the main product list cache
    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true }
    ]);
    res.json({ success: true, message: "Product cache invalidated." });
  } catch (error) {
    console.error("❌ Error invalidating cache:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ... [Keep existing GET routes with cache enabled] ...
router.get("/", cache(makeAllProductsKey(), 3600), async (req, res) => {
  // ... existing code ...
  try {
    const products = await db.query.productsTable.findMany({
      where: eq(productsTable.isArchived, false),
      with: { variants: { where: eq(productVariantsTable.isArchived, false) } },
    });
    res.json(products);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟢 NEW: Powerful Aura Match Endpoint
router.post('/aura-match', async (req, res) => {
  const { occasion, vibe } = req.body;
  // occasion: { label: "Date Night", keywords: [...] }
  // vibe: { label: "Powerful", keywords: [...] }

  try {
    // 1. Fetch Candidates
    const candidates = await db.query.productsTable.findMany({
      where: and(
        eq(productsTable.isArchived, false),
        ne(productsTable.category, 'Template')
      ),
      with: {
        variants: {
           where: and(
            eq(productVariantsTable.isArchived, false),
            gt(productVariantsTable.stock, 0)
          )
        }
      }
    });

    if (!candidates.length) return res.status(404).json({ error: "No products available" });

    // 2. EXPAND KNOWLEDGE (Build the Target Note Profile)
    // We analyze the text labels to determine the internal 'key' for our intelligence engine
    
    // --- Determine Occasion Key ---
    const occLabel = (occasion?.label || "").toLowerCase();
    let occasionKey = "day"; // default
    if (occLabel.includes("night") || occLabel.includes("intimate") || occLabel.includes("date")) occasionKey = "night";
    else if (occLabel.includes("office") || occLabel.includes("boardroom") || occLabel.includes("work")) occasionKey = "office";
    else if (occLabel.includes("gala") || occLabel.includes("celebration") || occLabel.includes("luxury")) occasionKey = "gala";
    
    // --- Determine Vibe Key ---
    const vibeLabel = (vibe?.label || "").toLowerCase();
    let vibeKey = "serene"; // default
    if (vibeLabel.includes("powerful") || vibeLabel.includes("commanding") || vibeLabel.includes("bold")) vibeKey = "powerful";
    else if (vibeLabel.includes("mysterious") || vibeLabel.includes("dark") || vibeLabel.includes("complex")) vibeKey = "mysterious";
    else if (vibeLabel.includes("playful") || vibeLabel.includes("joy") || vibeLabel.includes("radiant")) vibeKey = "playful";

    // 3. COMPILE TARGET NOTES
    const occasionProfile = SCENT_INTELLIGENCE.occasions[occasionKey] || SCENT_INTELLIGENCE.occasions["day"];
    const vibeProfile = SCENT_INTELLIGENCE.vibes[vibeKey] || SCENT_INTELLIGENCE.vibes["serene"];

    const targetOccasionNotes = new Set(occasionProfile.notes);
    const targetVibeNotes = new Set(vibeProfile.notes);
    
    // Also include any raw keywords sent from frontend as fallback/supplement
    const frontendKeywords = [...(occasion?.keywords || []), ...(vibe?.keywords || [])].map(k => k.toLowerCase());

    // 4. SCORING ALGORITHM
    const scoredProducts = candidates.map(product => {
      let score = 0;
      let matchedNotes = [];

      // Extract product DNA (normalize to lower case)
      // composition = Top Notes
      // fragrance = Heart/Middle Notes (and Family)
      // fragranceNotes = Base Notes
      const topNotes = (product.composition || "").toLowerCase();
      const heartNotes = (product.fragrance || "").toLowerCase();
      const baseNotes = (product.fragranceNotes || "").toLowerCase();
      const fullDesc = (product.description || "").toLowerCase();

      // --- A. INTELLIGENT NOTE MATCHING ---
      
      // Function to check notes against a target set
      const checkNotes = (sourceText, noteSet, multiplier) => {
        let localScore = 0;
        noteSet.forEach(note => {
          if (sourceText.includes(note)) {
            localScore += (1 * multiplier);
            if (!matchedNotes.includes(note)) matchedNotes.push(note);
          }
        });
        return localScore;
      };

      // Base Notes (Highest Weight - The "Aura")
      score += checkNotes(baseNotes, targetOccasionNotes, 3); 
      score += checkNotes(baseNotes, targetVibeNotes, 3);

      // Heart Notes (Medium Weight - The "Character")
      score += checkNotes(heartNotes, targetOccasionNotes, 2);
      score += checkNotes(heartNotes, targetVibeNotes, 2);

      // Top Notes (Low Weight - The "Opening")
      score += checkNotes(topNotes, targetOccasionNotes, 1);
      score += checkNotes(topNotes, targetVibeNotes, 1);


      // --- B. FRAGRANCE FAMILY ALIGNMENT ---
      // If the product belongs to the preferred family of the occasion (e.g. Occasion="Night", Family="Oriental")
      if (occasionProfile.preferredFamilies) {
        occasionProfile.preferredFamilies.forEach(fam => {
          if (heartNotes.includes(fam) || fullDesc.includes(fam)) {
            score += 4; // Significant boost for correct family
          }
        });
      }

      // --- C. KEYWORD FALLBACK (Frontend Inputs) ---
      frontendKeywords.forEach(k => {
        if (fullDesc.includes(k) || baseNotes.includes(k)) score += 1;
      });

      // --- D. SYNERGY BONUS ---
      // If product has notes from BOTH the Occasion AND the Vibe, it's a "Perfect Harmony"
      const hasOccasionMatch = Array.from(targetOccasionNotes).some(n => (baseNotes + heartNotes).includes(n));
      const hasVibeMatch = Array.from(targetVibeNotes).some(n => (baseNotes + heartNotes).includes(n));
      
      if (hasOccasionMatch && hasVibeMatch) {
        score += 10; // Massive boost for hitting both criteria
      }

      return { ...product, score, matchedNotes };
    });

    // 5. SORT & SELECT
    scoredProducts.sort((a, b) => b.score - a.score);
    
    // Log logic for debugging (optional)
    // console.log("Top Match:", scoredProducts[0]?.name, "Score:", scoredProducts[0]?.score, "Matches:", scoredProducts[0]?.matchedNotes);

    const bestMatch = scoredProducts.length > 0 ? scoredProducts[0] : candidates[0];

    // Clean image
    if (typeof bestMatch.imageurl === "string") {
       try { bestMatch.imageurl = JSON.parse(bestMatch.imageurl); } catch {}
    }

    res.json(bestMatch);

  } catch (error) {
    console.error("❌ Aura Match Error:", error);
    res.status(500).json({ error: "Server error during calculation" });
  }
});

router.post('/recommendations', async (req, res) => {
  const { excludeIds, userId } = req.body;

  try {
    // 1. SANITIZE INPUTS
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const safeExcludeIds = (excludeIds || []).filter(id => typeof id === 'string' && uuidRegex.test(id));
    const safeUserId = (typeof userId === 'string' && uuidRegex.test(userId)) ? userId : null;

    // 2. AGGREGATE USER HISTORY
    let sourceProductIds = new Set(safeExcludeIds);

    if (safeUserId) {
      // Recent Orders
      const recentOrders = await db.select({ productId: orderItemsTable.productId })
        .from(orderItemsTable)
        .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
        .where(eq(ordersTable.userId, safeUserId))
        .orderBy(desc(ordersTable.createdAt))
        .limit(10);

      recentOrders.forEach(o => sourceProductIds.add(o.productId));

      // Wishlist
      const wishlist = await db.select({ productId: productVariantsTable.productId })
        .from(wishlistTable)
        .innerJoin(productVariantsTable, eq(wishlistTable.variantId, productVariantsTable.id))
        .where(eq(wishlistTable.userId, safeUserId));

      wishlist.forEach(w => sourceProductIds.add(w.productId));
    }

    // 3. FETCH CANDIDATES
    // Filter: Active products AND NOT 'Template' category
    let whereClause = and(
        eq(productsTable.isArchived, false),
        ne(productsTable.category, 'Template') 
    );

    if (safeExcludeIds.length > 0) {
      whereClause = and(
        eq(productsTable.isArchived, false),
        ne(productsTable.category, 'Template'),
        notInArray(productsTable.id, safeExcludeIds)
      );
    }

    let candidates = await db.query.productsTable.findMany({
      where: whereClause,
      with: {
        variants: {
          // 🟢 EXPLICITLY SELECT COLUMNS (Added 'name' here)
          columns: {
            id: true,
            name: true,     // <--- ADDED: Fixes the "undefined" toast issue
            size: true,
            oprice: true,
            discount: true,
            stock: true,
            isArchived: true
          },
          where: and(
            eq(productVariantsTable.isArchived, false),
            gt(productVariantsTable.stock, 0)
          )
        }
      }
    });

    if (candidates.length === 0) return res.json([]);

    // 4. SCORE & RETURN
    const uniqueSourceIds = Array.from(sourceProductIds);
    const safeSourceIds = uniqueSourceIds.filter(id => uuidRegex.test(id));

    if (safeSourceIds.length === 0) {
      return res.json([]);
    }

    // Fetch source products for matching
    let sourceProducts = [];
    if (safeSourceIds.length > 0) {
      sourceProducts = await db.query.productsTable.findMany({
        where: inArray(productsTable.id, safeSourceIds),
      });
    }

    const profile = { compositions: new Set(), fragrances: new Set(), notes: new Set() };

    sourceProducts.forEach(p => {
      if (p.composition) profile.compositions.add(p.composition.toLowerCase().trim());
      if (p.fragrance) profile.fragrances.add(p.fragrance.toLowerCase().trim());
      if (p.fragranceNotes) p.fragranceNotes.split(',').forEach(n => profile.notes.add(n.toLowerCase().trim()));
    });

    const scoredCandidates = candidates.map(product => {
      let score = 0;
      let reasons = [];

      if (product.composition && profile.compositions.has(product.composition.toLowerCase().trim())) score += 2;
      if (product.fragrance && profile.fragrances.has(product.fragrance.toLowerCase().trim())) {
        score += 3;
        reasons.push(product.fragrance);
      }

      const matchReason = reasons.length > 0 ? reasons.join(" • ") : "Trending";
      return { ...product, score, matchReason };
    })
    // Filter: Only keep items that match
    .filter(product => product.score > 0);

    // Sort by score
    scoredCandidates.sort((a, b) => b.score - a.score);

    res.json(scoredCandidates.slice(0, 4));

  } catch (error) {
    console.error("Recommend Error:", error);
    res.json([]);
  }
});

export default router;