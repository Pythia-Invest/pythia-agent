"""The protocols this plugin names, each keyed by the ORIGINAL package id of its main code family.

An upgrade publishes a new package id but types keep the id that first defined them, so the original id names the family
for ever and verifies on chain without the protocol: `package(address: <id>, version: 1)` answers the id itself only
when it is the original. A protocol that ships several families (NAVI's oracle, Bluefin's perps, Cetus's DLMM, Bucket's
stablecoin) is still one record: the family holding the markets this plugin reads, or the best known, is the key, and
the others are listed as aliases, since a record states one `sui_package`. The ids are those read from chain objects on
2026-09-30; a protocol whose id the chain does not confirm is left out with a warning, never guessed.
"""
# (name, (original package id, module the family must still have), other families as the same pairs)
PROTOCOLS = (
    ('NAVI Lending', ('0xd899cf7d2b5db716bd2cf55599fb0d5ee38a3061e7b6bb6eebf73fa5bc4c81ca', 'pool'), ()),
    ('Suilend', ('0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf', 'lending_market'), ()),
    ('Scallop', ('0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf', 'market'), ()),
    ('Cetus CLMM', ('0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb', 'pool'),
     (('0x5664f9d3fd82c84023870cfbda8ea84e14c8dd56ce557ad2116e0668581a682b', 'dlmm_math'),)),  # Cetus DLMM
    ('DeepBook V3', ('0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809', 'pool'), ()),
    # Bluefin Spot keys the record; Bluefin Pro (perpetuals) is the alias.
    ('Bluefin', ('0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267', 'pool'),
     (('0xe74481697f432ddee8dd6f9bd13b9d0297a5b63d55f3db25c4d3b5d34dad85b7', 'bank'),)),
    ('Turbos', ('0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1', 'pool'), ()),
    ('Momentum', ('0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860', 'pool'), ()),
    ('AlphaLend', ('0xd631cd66138909636fc3f73ed75820d0c5b76332d1644608ed1c85ea2b8219b4', 'alpha_lending'), ()),
    # Bucket V2's `Config` names ten families; the CDP keys it and the USDB stablecoin's is the alias.
    ('Bucket Protocol', ('0x9f835c21d21f8ce519fec17d679cd38243ef2643ad879e7048ba77374be4036e', 'vault'),
     (('0xe14726c336e81b32328e92afc37345d159f5b550b09fa92bd43640cfdd0a0cfd', 'usdb'),)),
)


def resolved(chain):
    """The protocols the chain confirms, and what it did not: ({original id: record}, found). A record holds the name,
    the verified other families, and the latest id and version at read time (an observation, not an identifier).
    `found` counts what a read should warn about: a family the chain does not know (`missing`), one whose id is not
    the original (`not_original`), or whose anchor module has gone from its latest version (`changed`)."""
    specs = [spec for _name, main, others in PROTOCOLS for spec in (main, *others)]
    answers = dict(zip([spec[0] for spec in specs], chain.families(specs)))
    found, rows = {'missing': [], 'not_original': [], 'changed': []}, {}
    for name, (original, anchor), others in PROTOCOLS:
        family = answers[original]
        if family is None:
            found['missing'].append(name)
        elif family['original'] != original:
            found['not_original'].append(name)
        elif not family['anchor']:
            found['changed'].append(name)
        else:
            extra = [other for other, _module in others
                     if answers[other] and answers[other]['original'] == other and answers[other]['anchor']]
            rows[original] = {'name': name, 'latest': family['latest'], 'version': family['version'], 'others': extra}
    return rows, found
