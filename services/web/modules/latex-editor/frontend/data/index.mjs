/**
 * Consolidated symbol category data for the LaTeX equation editor.
 * Each category has a name, display label, and array of symbols.
 */
import { greekCategory } from './greek.mjs'
import { operatorsCategory } from './operators.mjs'
import { arrowsCategory } from './arrows.mjs'
import { delimitersCategory } from './delimiters.mjs'
import { relationsCategory } from './relations.mjs'
import { fractionsCategory } from './fractions.mjs'
import { calculusCategory } from './calculus.mjs'
import { functionOperatorsCategory } from './functionoperators.mjs'
import { fontStylesCategory } from './fontstyles.mjs'
import { miscellaneousSymbolsCategory } from './miscellaneoussymbols.mjs'
import { matricesCategory } from './matrices.mjs'
import { largeOperatorsCategory } from './largeoperators.mjs'
import { setsCategory } from './sets.mjs'
import { equationEnvironmentsCategory } from './equationenvironment.mjs'
import { advancedConstructsCategory } from './advancedconstructs.mjs'
import { spacingCategory } from './spacing.mjs'

export const primaryCategories = [
    greekCategory,
    delimitersCategory,
    arrowsCategory,
    operatorsCategory,
    relationsCategory,
    fractionsCategory,
    calculusCategory,
]

export const secondaryCategories = [
    functionOperatorsCategory,
    fontStylesCategory,
    miscellaneousSymbolsCategory,
    matricesCategory,
    largeOperatorsCategory,
    setsCategory,
    equationEnvironmentsCategory,
    advancedConstructsCategory,
    spacingCategory,
]

export const allCategories = [...primaryCategories, ...secondaryCategories]
