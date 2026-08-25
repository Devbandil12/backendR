import * as CatalogRepository from "./catalog.repository.js";
import { audit } from "../../infrastructure/audit/audit.service.js";
import { ACTOR_TYPES } from "../../infrastructure/audit/audit.constants.js";

const SCENT_INTELLIGENCE = {
  occasions: {
    "night": { 
      notes: ["vanilla", "amber", "musk", "oud", "rose", "patchouli", "sandalwood", "tobacco", "leather", "tonka", "cinnamon", "cardamom", "jasmine", "black orchid", "cocoa"],
      preferredFamilies: ["oriental", "gourmand", "woody", "spicy"]
    },
    "office": { 
      notes: ["bergamot", "vetiver", "cedar", "neroli", "lemon", "white musk", "iris", "green tea", "grapefruit", "ginger", "mint", "bamboo", "lavender"],
      preferredFamilies: ["citrus", "fresh", "green", "aromatic"]
    },
    "gala": { 
      notes: ["oud", "saffron", "tuberose", "champagne", "gold amber", "black currant", "ylang-ylang", "rose", "incense", "myrrh", "truffle"],
      preferredFamilies: ["floral", "oriental", "chypre"]
    },
    "day": { 
      notes: ["sea salt", "aqua", "apple", "pear", "peach", "lavender", "sage", "white tea", "cotton", "peony", "freesia", "lily", "citrus"],
      preferredFamilies: ["aquatic", "fruity", "floral", "fresh"]
    }
  },
  vibes: {
    "powerful": { 
      notes: ["oud", "leather", "tobacco", "black pepper", "cedarwood", "oakmoss", "patchouli", "dark musk", "civet", "birch"],
    },
    "mysterious": { 
      notes: ["incense", "myrrh", "violet", "labdanum", "guaiac wood", "dark chocolate", "plum", "black orchid", "smoke", "resins"],
    },
    "playful": { 
      notes: ["citrus", "raspberry", "strawberry", "honey", "caramel", "coconut", "mint", "pink pepper", "orange blossom", "vanilla"],
    },
    "serene": { 
      notes: ["bamboo", "green tea", "eucalyptus", "sandalwood", "chamomile", "white woods", "lotus", "fig", "matcha", "cashmere"],
    }
  }
};

export const getEnrichedActiveProducts = async () => {
  const productsData = await CatalogRepository.getActiveProductsWithVariants();
  const reviewStats = await CatalogRepository.getReviewStats();

  const reviewMap = {};
  reviewStats.forEach((r) => {
    reviewMap[r.productId] = {
      count: Number(r.count),
      avg: Number(r.avgRating).toFixed(1)
    };
  });

  return productsData.map((product) => {
    const soldCount = product.variants 
      ? product.variants.reduce((sum, v) => sum + (v.sold || 0), 0) 
      : 0;
    
    const stats = reviewMap[product.id] || { count: 0, avg: 0 };

    return { 
      ...product, 
      soldCount, 
      reviewCount: stats.count,
      avgRating: stats.avg 
    };
  });
};

export const getArchivedProducts = async () => {
  return await CatalogRepository.getArchivedProducts();
};

export const getProductDetails = async (id) => {
  const product = await CatalogRepository.getProductById(id);
  
  if (!product) return null;

  if (product.variants) {
     product.soldCount = product.variants.reduce((sum, v) => sum + (v.sold || 0), 0);
  }
  if (product.reviews) {
     product.reviewCount = product.reviews.length;
  }

  if (typeof product.imageurl === "string") { 
    try { product.imageurl = JSON.parse(product.imageurl); } catch { } 
  }
  return product;
};

export const createProduct = async (productData, variants, actorId) => {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error("Product must have at least one variant.");
  }

  return await CatalogRepository.createProductWithVariants(productData, variants, actorId);
};

export const updateProduct = async (id, productData, variants, actorId) => {
  const currentProduct = await CatalogRepository.getProductByIdRaw(id);
  
  let updatedProduct = currentProduct;
  
  if (Object.keys(productData).length > 0) {
    updatedProduct = await CatalogRepository.updateProduct(id, productData);
  }

  if (!updatedProduct) throw new Error("Product not found.");

  if (actorId && currentProduct) {
    const truncate = (str, len = 25) => str?.length > len ? str.substring(0, len) + '...' : (str || 'None');
    
    const changes = [];
    if (productData.name && productData.name !== currentProduct.name) {
      changes.push(`Name: ${currentProduct.name} → ${productData.name}`);
    }
    if (productData.category && productData.category !== currentProduct.category) {
      changes.push(`Category: ${currentProduct.category} → ${productData.category}`);
    }
    if (productData.description && productData.description !== currentProduct.description) {
      changes.push(`Description: ${truncate(currentProduct.description)} → ${truncate(productData.description)}`);
    }
    if (productData.composition && productData.composition !== currentProduct.composition) {
      changes.push(`Top Notes: ${truncate(currentProduct.composition)} → ${truncate(productData.composition)}`);
    }
    if (productData.fragrance && productData.fragrance !== currentProduct.fragrance) {
      changes.push(`Heart Notes: ${truncate(currentProduct.fragrance)} → ${truncate(productData.fragrance)}`);
    }
    if (productData.fragranceNotes && productData.fragranceNotes !== currentProduct.fragranceNotes) {
      changes.push(`Base Notes: ${truncate(currentProduct.fragranceNotes)} → ${truncate(productData.fragranceNotes)}`);
    }

    if (changes.length > 0 || (variants && variants.length > 0)) {
      await audit.log({
        actorUserId: actorId,
        actorType: ACTOR_TYPES.ADMIN,
        action: 'PRODUCT_UPDATED',
        resourceType: 'PRODUCT',
        resourceId: id,
        changes,
        resourceData: updatedProduct,
        description: `Updated product ${updatedProduct.name}: ${changes.length > 0 ? changes.join(', ') : 'Details updated'}`
      });
    }
  }

  return updatedProduct;
};

export const bulkUpdateVariants = async (updates, actorId) => {
  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    throw new Error("No updates provided.");
  }
  await CatalogRepository.bulkUpdateVariants(updates, actorId);
};

export const archiveProduct = async (id, actorId) => {
  const product = await CatalogRepository.setProductArchiveStatus(id, true, actorId, null);
  if (!product) throw new Error("Product not found.");
  return product;
};

export const unarchiveProduct = async (id, actorId) => {
  const product = await CatalogRepository.setProductArchiveStatus(id, false, actorId, null);
  if (!product) throw new Error("Product not found.");
  return product;
};

export const getAuraMatch = async (occasion, vibe) => {
  const candidates = await CatalogRepository.getCandidatesForAuraMatch();
  if (!candidates.length) throw new Error("No products available");

  const occLabel = (occasion?.label || "").toLowerCase();
  let occasionKey = "day"; 
  if (occLabel.includes("night") || occLabel.includes("intimate") || occLabel.includes("date")) occasionKey = "night";
  else if (occLabel.includes("office") || occLabel.includes("boardroom") || occLabel.includes("work")) occasionKey = "office";
  else if (occLabel.includes("gala") || occLabel.includes("celebration") || occLabel.includes("luxury")) occasionKey = "gala";
  
  const vibeLabel = (vibe?.label || "").toLowerCase();
  let vibeKey = "serene";
  if (vibeLabel.includes("powerful") || vibeLabel.includes("commanding") || vibeLabel.includes("bold")) vibeKey = "powerful";
  else if (vibeLabel.includes("mysterious") || vibeLabel.includes("dark") || vibeLabel.includes("complex")) vibeKey = "mysterious";
  else if (vibeLabel.includes("playful") || vibeLabel.includes("joy") || vibeLabel.includes("radiant")) vibeKey = "playful";

  const occasionProfile = SCENT_INTELLIGENCE.occasions[occasionKey] || SCENT_INTELLIGENCE.occasions["day"];
  const vibeProfile = SCENT_INTELLIGENCE.vibes[vibeKey] || SCENT_INTELLIGENCE.vibes["serene"];

  const targetOccasionNotes = new Set(occasionProfile.notes);
  const targetVibeNotes = new Set(vibeProfile.notes);
  
  const frontendKeywords = [...(occasion?.keywords || []), ...(vibe?.keywords || [])].map(k => k.toLowerCase());

  const scoredProducts = candidates.map(product => {
    let score = 0;
    let matchedNotes = [];

    const topNotes = (product.composition || "").toLowerCase();
    const heartNotes = (product.fragrance || "").toLowerCase();
    const baseNotes = (product.fragranceNotes || "").toLowerCase();
    const fullDesc = (product.description || "").toLowerCase();

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

    score += checkNotes(baseNotes, targetOccasionNotes, 3); 
    score += checkNotes(baseNotes, targetVibeNotes, 3);
    score += checkNotes(heartNotes, targetOccasionNotes, 2);
    score += checkNotes(heartNotes, targetVibeNotes, 2);
    score += checkNotes(topNotes, targetOccasionNotes, 1);
    score += checkNotes(topNotes, targetVibeNotes, 1);

    if (occasionProfile.preferredFamilies) {
      occasionProfile.preferredFamilies.forEach(fam => {
        if (heartNotes.includes(fam) || fullDesc.includes(fam)) {
          score += 4; 
        }
      });
    }

    frontendKeywords.forEach(k => {
      if (fullDesc.includes(k) || baseNotes.includes(k)) score += 1;
    });

    const hasOccasionMatch = Array.from(targetOccasionNotes).some(n => (baseNotes + heartNotes).includes(n));
    const hasVibeMatch = Array.from(targetVibeNotes).some(n => (baseNotes + heartNotes).includes(n));
    
    if (hasOccasionMatch && hasVibeMatch) {
      score += 10; 
    }

    return { ...product, score, matchedNotes };
  });

  scoredProducts.sort((a, b) => b.score - a.score);
  const bestMatch = scoredProducts.length > 0 ? scoredProducts[0] : candidates[0];

  if (typeof bestMatch.imageurl === "string") {
     try { bestMatch.imageurl = JSON.parse(bestMatch.imageurl); } catch {}
  }

  return bestMatch;
};

export const getRecommendations = async (excludeIds, userId) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const safeExcludeIds = (excludeIds || []).filter(id => typeof id === 'string' && uuidRegex.test(id));
  
  let sourceProductIds = new Set(safeExcludeIds);

  if (userId) {
    const recentOrders = await CatalogRepository.getRecentOrdersProductIds(userId);
    recentOrders.forEach(o => sourceProductIds.add(o.productId));

    const wishlist = await CatalogRepository.getWishlistProductIds(userId);
    wishlist.forEach(w => sourceProductIds.add(w.productId));
  }

  let candidates = await CatalogRepository.getCandidatesForRecommendations(safeExcludeIds);
  if (candidates.length === 0) return [];

  const uniqueSourceIds = Array.from(sourceProductIds);
  const safeSourceIds = uniqueSourceIds.filter(id => uuidRegex.test(id));

  if (safeSourceIds.length === 0) return [];

  let sourceProducts = [];
  if (safeSourceIds.length > 0) {
    sourceProducts = await CatalogRepository.getProductsByIds(safeSourceIds);
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
  }).filter(product => product.score > 0);

  scoredCandidates.sort((a, b) => b.score - a.score);
  return scoredCandidates.slice(0, 4);
};
