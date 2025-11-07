// build.mjs (ESM, Style Dictionary v4)
import StyleDictionary from 'style-dictionary';

// ==============================
// CONFIG DINÂMICA
// ==============================
function getStyleDictionaryConfig(brand, platform) {
  return {
    source: [
      `src/brands/${brand}/*.json`,
      'src/globals/**/*.json',
      `src/platforms/${platform}/*.json`,
    ],
    platforms: {
      'web/js': {
        transformGroup: 'tokens-js',
        buildPath: `dist/web/${brand}/`,
        prefix: 'dsm',
        files: [
          // { destination: 'tokens.module.js', format: 'javascript/module' },
          // { destination: 'tokens.object.js', format: 'javascript/object' },
          { 
            destination: 'tokens.es6.js', 
            format: 'javascript/es6',
            options: { outputReferences: true } // 👈 mantém referências 
        }],
      },
      'web/json': {
        transformGroup: 'tokens-json',
        buildPath: `dist/web/${brand}/`,
        prefix: 'dsm',
        files: [{ 
            destination: 'tokens.json', 
            format: 'json/flat',
            options: { outputReferences: true } // 👈 mantém referências 
        }],
      },
      'web/scss': {
        transformGroup: 'tokens-scss',
        buildPath: `dist/web/${brand}/`,
        prefix: 'dsm',
        files: [{ 
            destination: 'tokens.scss', 
            format: 'scss/css-variables', //formato customizado
            options: { 
                varPrefix: '--',       // simbolo inicial S
                selector: ':root',     // opcional
                wrapInSelector: true,  // opcional (auto-true se varPrefix começa com --)
                useVarFunc: true,      // referências viram var(--nome)
            } 
         }],
      },
      styleguide: {
        transformGroup: 'styleguide',
        buildPath: `dist/styleguide/`,
        prefix: 'dsm',
        files: [
          { destination: `${platform}_${brand}.json`, format: 'json/flat' },
          { destination: `${platform}_${brand}.scss`, format: 'scss/variables' },
        ],
      },
      
      ios: {
        transformGroup: 'tokens-ios',
        buildPath: `dist/ios/${brand}/`,
        prefix: 'token',
        files: [
          { 
            destination: 'tokens-all.plist',
            format: 'ios/plist-alias',        // 👈 nome único p/ evitar colisão
            options: { useReferences: true }  // 👈 a opção correta no nosso format
        },
          {
            destination: 'tokens-colors.plist',
            format: 'ios/plist-alias',
            filter: { type: 'color' },
            options: { useReferences: true }
          },
        ],
      },
      
      android: {
        transformGroup: 'tokens-android',
        buildPath: `dist/android/${brand}/`,
        prefix: 'token',
        files: [
          { 
            destination: 'tokens-all.xml', 
            format: 'android/xml',
            options: { outputReferences: true } // 👈 mantém referências 
        },
          {
            destination: 'tokens-colors.xml',
            format: 'android/xml',
            filter: { type: 'color' },
          },
        ],
      },
    },
  };
}

// ===========================================
// REGISTROS: FORMATS / TRANSFORMS / GROUPS v4
// ===========================================

// v4: use 'format' (não 'formatter') e dictionary.allTokens (não allProperties)
StyleDictionary.registerFormat({
  name: 'json/flat',
  format: ({ dictionary }) => JSON.stringify(dictionary.allTokens, null, 2),
});

// Substitui seus templates por formats equivalentes:

// --- iOS .plist: escreve o NOME do token referenciado em vez do valor ---
StyleDictionary.registerFormat({
  name: 'ios/plist-alias',
  format: ({ dictionary, options = {} }) => {
    const useReferences = options.useReferences ?? true; // quando true, refs viram nome de token
    const rawValue = (t) => t.original?.value ?? t.$value ?? t.value;

    const renderValue = (t) => {
      const raw = rawValue(t);
      if (!useReferences || typeof raw !== 'string') return String(raw);

      // caso simples: a string É apenas uma ref {a.b.c(.value)}
      if (raw.startsWith('{') && raw.endsWith('}')) {
        const refPath = normalizeRefPath(raw.slice(1, -1));
        const refToken = findTokenByPath(dictionary, refPath);
        if (refToken) return refToken.name;
      }

      // caso geral: substituir TODAS as refs dentro da string
      return raw.replace(/\{([^}]+)\}/g, (_m, inner) => {
        const refPath = normalizeRefPath(inner);
        const refToken = findTokenByPath(dictionary, refPath);
        return refToken ? refToken.name : `{${inner}}`;
      });
    };

    const lines = dictionary.allTokens.map((t) =>
      `\t<key>${t.name}</key>\n\t<string>${renderValue(t)}</string>`
    );

    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
      `<plist version="1.0">\n<dict>\n${lines.join('\n')}\n</dict>\n</plist>\n`;
  },
});



// Android .xml de resources
StyleDictionary.registerFormat({
  name: 'android/xml',
  format: ({ dictionary, options = {} }) => {
    const useReferences = options.useReferences ?? true; // quando true, refs viram @type/name
    const rawValue = (t) => t.original?.value ?? t.$value ?? t.value;

    const renderValue = (token) => {
      const raw = rawValue(token);

      if (!useReferences || typeof raw !== 'string') return String(raw);

      // caso 1: valor é só uma referência {a.b.c(.value)}
      if (raw.startsWith('{') && raw.endsWith('}')) {
        const refPath = normalizeRefPath(raw.slice(1, -1));
        const refToken = findTokenByPath(dictionary, refPath);
        if (refToken) {
          const refType = androidTagFor(refToken);
          return `@${refType}/${refToken.name}`;
        }
      }

      // caso 2: há referências embutidas em strings
      // OBS: Android não suporta composições tipo "@color/a 50%" em <color> ou <dimen>.
      // Se isso acontecer, vamos apenas substituir dentro de <string>. Para recursos não-string, manteremos literal.
      return raw.replace(/\{([^}]+)\}/g, (_m, inner) => {
        const refPath = normalizeRefPath(inner);
        const refToken = findTokenByPath(dictionary, refPath);
        if (!refToken) return `{${inner}}`;
        const refType = androidTagFor(refToken);
        return `@${refType}/${refToken.name}`;
      });
    };

    const items = dictionary.allTokens.map((t) => {
      const tag = androidTagFor(t);
      const val = renderValue(t);

      // segurança: se for composição não suportada para <color>/<dimen>/etc., force <string>
      if ((tag === 'color' || tag === 'dimen' || tag === 'integer') && /[@{].*[}\s]/.test(rawValue(t))) {
        // contém referência embutida/misturada; exporta como string
        return `    <string name="${t.name}">${val}</string>`;
      }

      return `    <${tag} name="${t.name}">${val}</${tag}>`;
    });

    return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${items.join('\n')}\n</resources>\n`;
  },
});


// formato SCSS custom com variáveis CSS (prefixo --)
StyleDictionary.registerFormat({
  name: 'scss/css-variables',
  format: ({ dictionary, options = {} }) => {
    const varPrefix = options.varPrefix ?? '--';
    const selector = options.selector ?? ':root';
    const wrapInSelector = options.wrapInSelector ?? varPrefix.startsWith('--');
    const useVarFunc = options.useVarFunc ?? true;

    const varName = (name) => `${varPrefix}${name}`;

    // normaliza caminho de referência removendo .value / .$value (e espaços)
    const normalizeRefPath = (p) =>
      p.trim().replace(/\.(\$?value)$/i, '');

    // troca TODAS as {refs} em uma string, se existirem
    const replaceRefsInString = (str) => {
      return str.replace(/\{([^}]+)\}/g, (_match, rawPath) => {
        const refPath = normalizeRefPath(rawPath);
        const refToken = dictionary.allTokens.find(
          (t) => t.path.join('.') === refPath
        );
        if (refToken) {
          const refVar = varName(refToken.name);
          // se prefixo começa com -- e useVarFunc=true, usa var(--xxx)
          return (useVarFunc && varPrefix.startsWith('--'))
            ? `var(${refVar})`
            : refVar;
        }
        // fallback: mantém como estava se não encontrar
        return `{${rawPath}}`;
      });
    };

    const lines = dictionary.allTokens.map((token) => {
      const raw = token.original?.value ?? token.$value ?? token.value;

      if (typeof raw === 'string') {
        const valueWithRefs = replaceRefsInString(raw);
        return `  ${varName(token.name)}: ${valueWithRefs};`;
      }

      // valores não-string (número, bool, etc.)
      return `  ${varName(token.name)}: ${raw};`;
    });

    const body = lines.join('\n');
    return wrapInSelector ? `${selector} {\n${body}\n}` : body;
  },
});

// normaliza caminho removendo .value / .$value
const normalizeRefPath = (p) => p.trim().replace(/\.(\$?value)$/i, '');

// encontra token por path "a.b.c"
const findTokenByPath = (dictionary, refPath) =>
  dictionary.allTokens.find((t) => t.path.join('.') === refPath);

// mapeia tipo SD -> tipo de recurso Android
const androidTagFor = (t) => {
  if (t.type === 'color') return 'color';
  if (t.type === 'dimension' || t.type === 'size' || t.attributes?.category === 'size') return 'dimen';
  if (t.type === 'time' || t.attributes?.category === 'time') return 'integer'; // ajuste se quiser <item type="id"> etc.
  return 'string';
};

StyleDictionary.registerTransform({
  name: 'size/pxToPt',
  type: 'value',
  matcher: (token) => typeof token.value === 'string' && /^[\d.]+px$/.test(token.value),
  transform: (token) => token.value.replace(/px$/, 'pt'),
});

StyleDictionary.registerTransform({
  name: 'size/pxToDp',
  type: 'value',
  matcher: (token) => typeof token.value === 'string' && /^[\d.]+px$/.test(token.value),
  transform: (token) => token.value.replace(/px$/, 'dp'),
});

StyleDictionary.registerTransformGroup({
  name: 'styleguide',
  transforms: ['attribute/cti', 'name/kebab', 'size/px', 'color/css'],
});

StyleDictionary.registerTransformGroup({
  name: 'tokens-js',
  transforms: ['name/constant', 'size/px', 'color/hex'],
});

StyleDictionary.registerTransformGroup({
  name: 'tokens-json',
  transforms: ['attribute/cti', 'name/kebab', 'size/px', 'color/css'],
});

StyleDictionary.registerTransformGroup({
  name: 'tokens-scss',
  transforms: ['name/kebab', 'time/seconds', 'size/px', 'color/css'],
});

StyleDictionary.registerTransformGroup({
  name: 'tokens-ios',
  transforms: ['attribute/cti', 'name/camel', 'size/pxToPt'],
});

StyleDictionary.registerTransformGroup({
  name: 'tokens-android',
  transforms: ['attribute/cti', 'name/camel', 'size/pxToDp'],
});

// ==============================
// BUILD (agora async/await)
// ==============================
console.log('Build started...');

const platforms = ['web', 'ios', 'android'];
const brands = ['brand#1', 'brand#2', 'brand#3'];

for (const platform of platforms) {
  for (const brand of brands) {
    console.log('\n==============================================');
    console.log(`\nProcessing: [${platform}] [${brand}]`);

    const sd = new StyleDictionary(getStyleDictionaryConfig(brand, platform));
    await sd.hasInitialized; // garante parse de fontes antes do build

    if (platform === 'web') {
      //await sd.buildPlatform('web/js');
      //await sd.buildPlatform('web/json');
      await sd.buildPlatform('web/scss');
    } else if (platform === 'ios') {
      await sd.buildPlatform('ios');
    } else if (platform === 'android') {
      await sd.buildPlatform('android');
    }
    await sd.buildPlatform('styleguide');

    console.log('\nEnd processing');
  }
}

console.log('\n==============================================');
console.log('\nBuild completed!');